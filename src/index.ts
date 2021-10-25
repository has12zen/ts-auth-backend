import 'reflect-metadata';
import 'dotenv-safe/config';
import express from 'express';
declare module 'express-session' {
	interface SessionData {
		username: string;
	}
}
import session from 'express-session';
import redis from 'redis';
import connectRedis from 'connect-redis';
import { Client } from 'pg';
import argon2 from 'argon2';
const client = new Client({
	connectionString: process.env.DATABASE_URL,
});
import sgMail from '@sendgrid/mail';
sgMail.setApiKey(process.env.SENDGRID_API || '');
import { msg_reset, msg_signup } from './util/email';
import { v4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3000;
// enable this if you run behind a proxy (e.g. nginx)
app.set('trust proxy', 1);
const RedisStore = connectRedis(session);
//Configure redis client
const redisClient = redis.createClient({
	host: process.env.REDIS_HOST,
	port: 12894,
	password: process.env.REDIS_PASS,
});

redisClient.on('error', function (err) {
	console.log('Could not establish a connection with redis. ' + err);
});
redisClient.on('connect', function (err) {
	console.log('Connected to redis successfully');
});
//Configure session middleware
app.use(
	session({
		store: new RedisStore({ client: redisClient }),
		secret: process.env.SESSION_SECRET || 'simple_secret',
		resave: false,
		saveUninitialized: false,
		cookie: {
			secure: false, // if true only transmit cookie over https
			httpOnly: false, // if true prevent client side JS from reading the cookie
			maxAge: 1000 * 60 * 10, // session max age in miliseconds
		},
	})
);
app.use(express.urlencoded({ extended: true })); //Parse URL-encoded bodies
//Express parser
app.use(express.json());

client.connect(function (err) {
	if (err) throw err;
	console.log('Connection to DB successful');
});

app.listen(PORT, () => {
	console.log(`Server is listening on port ${PORT}`);
});

// routes
app.get('/', (req, res) => {
	if (req.session.username) res.send('you are logged in');
	else res.send('Please log in');
});

app.post('/login', async (req, res) => {
	try {
		const query = 'SELECT * FROM user WHERE username = $1';
		const values = [req.body.username];
		const user_rows = await client.query(query, values);
		const user = user_rows.rows[0];
		console.log(user);
		if (await argon2.verify(user.password, req.body.password)) {
			// password match
			req.session.username = req.body.username;
			res.status(201).json({
				status: 'success',
				message: 'signup success',
			});
		} else {
			throw new Error('Wrong password');
		}
	} catch (err) {
		res.status(500).json({
			status: 'error',
			message: 'wrong username/password',
		});
	}
});

app.post('/signup', async (req, res) => {
	try {
		if (!isValidPass(req.body.password)) throw new Error('invalid pass');
		const hash = await argon2.hash(req.body.password);
		const query =
			'INSERT INTO users(username, email,password) VALUES($1, $2,$3) RETURNING userid';
		const values = [req.body.username, req.body.email, hash];
		msg_signup.to = req.body.email;
		sgMail.send(msg_signup);
		const useter = await client.query(query, values);
		res.status(201).json({
			status: 'success',
			message: 'signup success please login',
		});
	} catch (err) {
		console.log(err);
		res.status(500).json({
			status: 'error',
			message: 'something went wrong',
		});
	}
});

app.get('/logout', (req, res) => {
	try {
		req.session.destroy((err) => {
			if (err) throw err;
			res.redirect('/');
		});
	} catch (err) {
		console.log(err);
		res.status(500).json({
			status: 'error',
			message: 'something went wrong',
		});
	}
});

app.get('/resetpass', async (req, res) => {
	try {
		msg_reset.to = req.body.email;
		const query = 'SELECT userid,username FROM users WHERE email=$1';
		const values = [req.body.email];
		const token = v4();
		const user_row = await client.query(query, values);
		const hash = await argon2.hash(token);
		await redisClient.set(
			hash,
			user_row.rows[0].username,
			'ex',
			1000 * 60 * 10
		);
		msg_reset.text = `open this link in browser:${
			process.env.DOMAIN + '/verifypass?token=' + token
		}`;
		msg_reset.text = `<a href='${
			process.env.DOMAIN + '/verifypass?token=' + token
		}'>token</strong>`;
		sgMail.send(msg_reset);
	} catch (err) {
		console.log(err);
	} finally {
		res.status(200).json({
			message: 'email sent',
		});
	}
});

app.post('/verifypass', async (req, res) => {
	try {
		const newpassword = req.body.newpassword;
		const query =	'UPDATE users SET password = $1 WHERE username = $2';
		if (!isValidPass(newpassword)) throw new Error('invalid pass');
		const token = req.query.token;
		if (typeof token != 'string') throw new Error('something went wrong');
		const hash = await argon2.hash(token);
		const userid = await redisClient.get(hash);
		if(!userid)throw new Error('token expired');
		const hashpass=await argon2.hash(newpassword);
		const values= [hashpass,userid];
		await client.query(query,values);
		res.status(200).json({ message: 'pass reset success' });
	} catch (err) {
		res.status(400).json({ message: err.message });
	}
});
const isValidPass = (pass: string) => {
	if (pass.length > 4) return true;
	return false;
};
