import express from 'express';

const api = express();

// Security:
// https://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
api.disable('x-powered-by');

const allowCrossDomain = function (req: any, res: any, next: any) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Methods', 'POST');
    res.header("Access-Control-Allow-Headers", 'Origin, X-Requested-With, Content-Type, Accept');
    next();
};

api.get('/channel', (req, res) => {
    res.json({ 'hello-world': 'Feliĉa tago en infero' });
});

export default api;
