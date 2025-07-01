require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Secure with an API key from your .env file
const API_KEY = process.env.API_KEY || 'supersecretkey';
function authenticate(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Set up Stripe with your secret key
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}
const stripe = require('stripe')(stripeSecretKey);

// --- Endpoints ---

// 1. Connection Token (required for Stripe Terminal/S700)
app.post('/connection_token', authenticate, async (req, res) => {
  try {
    const token = await stripe.terminal.connectionTokens.create();
    res.json(token);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. (Optional) Health check endpoint
app.get('/', (req, res) => res.send('Stripe Terminal backend running.'));

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
