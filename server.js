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
    const { amount, currency, description, receipt_email } = req.body;
    // Add any extra params you need here (metadata, capture_method, etc.)
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      capture_method: 'automatic', // or 'manual' if you want to capture later
      description: description || 'Terminal Transaction',
      receipt_email: receipt_email || undefined,
      payment_method_types: ['card_present'], // important for Terminal
    });
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

// 5. Returns the total amount (in cents) of all successful PaymentIntents today
app.get('/transactions_today', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const created = {
      gte: Math.floor(midnight.getTime() / 1000), // UNIX timestamp in seconds
    };
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 100, // adjust if you expect more than 100 per day
      created,
    });

    // Sum the amounts for successful payments
    const total = paymentIntents.data
      .filter(pi => pi.status === 'succeeded')
      .reduce((sum, pi) => sum + pi.amount, 0);

    res.json({ total, currency: paymentIntents.data[0]?.currency || "eur" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

 // 6. Get the number of transactions 
app.post('/transactions_for_terminal', authenticate, async (req, res) => {
  try {
    const { start, end, terminal_id } = req.body;
    // Log the incoming request for debugging
    console.log("Received request to fetch transactions for terminal:");
    console.log(`Start Date: ${start}`);
    console.log(`End Date: ${end}`);
    console.log(`Terminal ID: ${terminal_id}`);
    if (!start || !end || !terminal_id) {
      return res.status(400).json({ error: 'Missing start, end, or terminal_id' });
    }

    // Convert start/end ISO strings to UNIX timestamps in seconds
    const created = {
      gte: Math.floor(new Date(start).getTime() / 1000),
      lte: Math.floor(new Date(end).getTime() / 1000),
    };

    // Log the converted timestamps for verification
    console.log(`Converted Start Timestamp: ${created.gte}`);
    console.log(`Converted End Timestamp: ${created.lte}`);

    // Fetch up to 500 transactions in range (adjust limit as needed)
    const paymentIntents = await stripe.paymentIntents.list({
      created,
      limit: 500,
    });

     // LOGGING: Show all payment intents, their status, and reader id for debugging
    console.log("Filtering for reader/terminal_id:", terminal_id);
    paymentIntents.data.forEach((pi) => {
      const charge = pi.charges?.data[0];
      const readerId = charge?.payment_method_details?.card_present?.reader;
      console.log(`Transaction ID: ${pi.id}, Reader ID: ${readerId}, Amount: ${pi.amount}, Status: ${pi.status}`);
    });

    // Filter for this terminal only
    const filtered = paymentIntents.data.filter((pi) => {
      const charge = pi.charges?.data[0];
      const readerId = charge?.payment_method_details?.card_present?.reader;
      return pi.status === 'succeeded'&& readerId === terminal_id;
    });

     // Log the filtered results (optional)
    console.log(`Found ${filtered.length} transactions for terminal ${terminal_id}`);

    // Optionally, sum amounts or return all details
    const total = filtered.reduce((sum, pi) => sum + pi.amount, 0);

    res.json({
      total,
      currency: filtered[0]?.currency || "eur",
      count: filtered.length,
      transactions: filtered, // Or just return the total/count if you prefer
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. (Optional) Health check endpoint
app.get('/', (req, res) => res.send('Stripe Terminal backend running.'));

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
