const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const youtubePuppeteerService = require('./services/youtubePuppeteerService');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "*.ytimg.com", "*.youtube.com"],
      fontSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'", "https:"],
      mediaSrc: ["'self'", "https:", "*.googlevideo.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? function(origin, callback) {
        if (!origin) return callback(null, true);
        const allowedOrigins = [
          /^https?:\/\/.*\.googleapis\.com$/,
          /^https?:\/\/\d+\.\d+\.\d+\.\d+:8080$/,
          'http://localhost:8080',
          'http://127.0.0.1:8080'
        ];
        const isAllowed = allowedOrigins.some(allowed => {
          if (typeof allowed === 'string') return allowed === origin;
          return allowed.test(origin);
        });
        callback(isAllowed ? null : new Error('Not allowed by CORS'), isAllowed);
      }
    : true,
  credentials: true,
  optionsSuccessStatus: 200
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/analyze', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'YouTube URL is required'
      });
    }

    if (!youtubePuppeteerService.isValidYouTubeUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL format'
      });
    }

    const analysis = await youtubePuppeteerService.analyzeVideo(url);
    
    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Error analyzing YouTube video:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze YouTube video',
      details: error.message
    });
  }
});

// Fallback endpoint using oEmbed API
app.post('/analyze-fallback', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'YouTube URL is required'
      });
    }

    const fallbackService = require('./services/youtubeServiceFallback');
    
    if (!fallbackService.isValidYouTubeUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL format'
      });
    }

    const analysis = await fallbackService.analyzeVideo(url);
    
    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Error in fallback analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze YouTube video using fallback method',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Something went wrong!'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`YouTube Analysis Service running on 0.0.0.0:${PORT}`);
  console.log(`Web interface: http://localhost:${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/analyze`);
  console.log(`Screenshots will be saved to: ${path.join(__dirname, 'screenshots')}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`External access: http://YOUR_VM_EXTERNAL_IP:${PORT}`);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await youtubePuppeteerService.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await youtubePuppeteerService.close();
  process.exit(0);
});

module.exports = app;
