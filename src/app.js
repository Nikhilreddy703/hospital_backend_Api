const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const config = require('./utils/config');
const db = require('./data/db');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(express.json());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ---- API documentation ----
const openApiSpec = YAML.parse(
  fs.readFileSync(path.join(__dirname, 'docs', 'openapi.yaml'), 'utf8')
);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get('/api-docs.json', (req, res) => res.json(openApiSpec)); // import this URL into Postman

// ---- System ----
app.get('/', (req, res) => res.redirect('/api-docs'));
app.get('/health', (req, res) =>
  res.json({ success: true, status: 'UP', service: 'hospital-mock-backend', time: new Date().toISOString() })
);

// ---- Business APIs ----
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
