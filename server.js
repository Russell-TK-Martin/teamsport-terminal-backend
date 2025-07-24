require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded form bodies (like Sinatra expects)
app.use(express.urlencoded({ extended: true }));

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

// 2. Create PaymentIntent endpoint for Stripe Terminal
app.post('/create_payment_intent', authenticate, async (req, res) => {
  console.log('POST /create_payment_intent', { body: req.body, headers: req.headers });
  try {
    const { amount, currency, description, receipt_email, terminal_label, staff_name } = req.body;
    // Add any extra params you need here (metadata, capture_method, etc.)
    console.log('Creating PI. staff_name:', staff_name, 'terminal_label:', terminal_label);
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      capture_method: 'automatic', // or 'manual' if you want to capture later
      description: description || 'Terminal Transaction',
      receipt_email: receipt_email || undefined,
      payment_method_types: ['card_present'], // important for Terminal
      metadata: {
        terminal_label: terminal_label || '',
        staff_name: staff_name || 'Unknown'
      }
    });
    console.log('PaymentIntent created. Metadata:', paymentIntent.metadata);
    // Return JSON matching old backend's format
    res.json({ intent: paymentIntent.id, secret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Capture PaymentIntent endpoint (if you use manual capture)
app.post('/capture_payment_intent', authenticate, async (req, res) => {
  try {
    const { payment_intent_id, amount_to_capture } = req.body;
    const params = amount_to_capture ? { amount_to_capture } : {};
    const paymentIntent = await stripe.paymentIntents.capture(payment_intent_id, params);
    res.json({ intent: paymentIntent.id, secret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update PaymentIntent with receipt email (for sending receipt after payment)
app.post('/update_payment_intent', authenticate, async (req, res) => {
  try {
    const { payment_intent_id, receipt_email } = req.body;
    if (!payment_intent_id || !receipt_email) {
      return res.status(400).json({ error: "Missing payment_intent_id or receipt_email" });
    }
    const paymentIntent = await stripe.paymentIntents.update(payment_intent_id, {
      receipt_email,
    });
    res.json({ success: true, paymentIntent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get the number of transactions
app.post('/transactions_for_terminal', authenticate, async (req, res) => {
  console.log("BODY:", req.body);
  try {
    const { start, end, staff_name } = req.body;
    console.log("Received request to fetch transactions for staff:", staff_name);

    if (!start || !end || !staff_name) {
      return res.status(400).json({ error: 'Missing start, end, or staff_name' });
    }

    const created = {
      gte: Math.floor(new Date(start).getTime() / 1000),
      lte: Math.floor(new Date(end).getTime() / 1000),
    };

    const paymentIntents = await stripe.paymentIntents.list({
      created,
      limit: 500,
    });

    const filtered = paymentIntents.data.filter((pi) =>
      pi.status === 'succeeded' && pi.metadata.staff_name === staff_name
    );

    const total = filtered.reduce((sum, pi) => sum + pi.amount, 0);

    res.json({
      total,
      currency: filtered[0]?.currency || "eur",
      count: filtered.length,
      transactions: filtered,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. (Optional) Health check endpoint
app.get('/', (req, res) => res.send('Stripe Terminal backend running.'));

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
