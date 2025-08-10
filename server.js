const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const youtubePuppeteerService = require('./services/youtubePuppeteerService');
const transcriptionService = require('./services/transcriptionService');
const resultsService = require('./services/resultsService');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet({
  contentSecurityPolicy: false,
  hsts: false,
  noSniff: false,
  frameguard: false,
  referrerPolicy: false
}));

app.use(cors({
  origin: true,
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
app.use('/audio', express.static(path.join(__dirname, 'audio')));

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

    console.log(`Starting analysis for: ${url}`);
    const analysis = await youtubePuppeteerService.analyzeVideo(url);
    
    // Save result and get ID
    const resultId = await resultsService.saveResult(analysis);
    
    res.json({
      success: true,
      resultId: resultId,
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

// Get result by ID
app.get('/result/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Result ID is required'
      });
    }

    const result = await resultsService.getResult(id);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Result not found'
      });
    }

    res.json({
      success: true,
      result: result
    });

  } catch (error) {
    console.error('Error fetching result:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch result',
      details: error.message
    });
  }
});

// List all results
app.get('/results', async (req, res) => {
  try {
    const results = await resultsService.listResults();
    
    res.json({
      success: true,
      results: results,
      count: results.length
    });

  } catch (error) {
    console.error('Error listing results:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list results',
      details: error.message
    });
  }
});

// Transcription endpoint
app.post('/transcribe', async (req, res) => {
  try {
    const { audioPath, audioUrl } = req.body;
    
    if (!audioPath && !audioUrl) {
      return res.status(400).json({
        success: false,
        error: 'Audio path or URL is required'
      });
    }

    let result;
    if (audioUrl) {
      result = await transcriptionService.transcribeFromUrl(audioUrl);
    } else {
      result = await transcriptionService.transcribeAudioFile(audioPath);
    }

    const formattedResult = transcriptionService.formatTranscription(result);

    res.json({
      success: result.success,
      transcription: formattedResult,
      timestamp: result.timestamp,
      source: audioUrl || audioPath
    });

  } catch (error) {
    console.error('Transcription endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message
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

// List available transcripts
app.get('/transcripts', (req, res) => {
  try {
    const fs = require('fs');
    const transcriptsDir = path.join(__dirname, 'transcripts');
    
    if (!fs.existsSync(transcriptsDir)) {
      return res.json({
        success: true,
        transcripts: []
      });
    }
    
    const files = fs.readdirSync(transcriptsDir)
      .filter(file => file.endsWith('.json'))
      .map(filename => {
        const filePath = path.join(transcriptsDir, filename);
        const stats = fs.statSync(filePath);
        
        // Try to read metadata from file
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          return {
            filename,
            created: stats.ctime,
            size: stats.size,
            metadata: content.metadata || {},
            success: content.success || false,
            hasAiAnalysis: !!(content.ai_analysis && content.ai_analysis.sentences),
            sentenceCount: content.ai_analysis?.sentences?.length || 0,
            overallAiProbability: content.ai_analysis?.overall_ai_probability || 0,
            textPreview: content.transcription?.text?.substring(0, 100) + '...' || 'No text available'
          };
        } catch (error) {
          return {
            filename,
            created: stats.ctime,
            size: stats.size,
            error: 'Failed to read file metadata'
          };
        }
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created)); // Newest first
    
    res.json({
      success: true,
      transcripts: files
    });
    
  } catch (error) {
    console.error('Error listing transcripts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list transcripts'
    });
  }
});

// Serve transcript files
app.get('/transcript/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const transcriptPath = path.join(__dirname, 'transcripts', filename);
    
    // Security check - ensure filename is safe
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename'
      });
    }
    
    // Check if file exists
    if (!require('fs').existsSync(transcriptPath)) {
      return res.status(404).json({
        success: false,
        error: 'Transcript file not found'
      });
    }
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Send file
    res.sendFile(transcriptPath);
    
  } catch (error) {
    console.error('Error serving transcript:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to serve transcript file'
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
  console.log(`API endpoints:`);
  console.log(`  POST /analyze - Analyze YouTube video`);
  console.log(`  GET /result/:id - Get analysis result by ID`);
  console.log(`  GET /results - List all results`);
  console.log(`  POST /transcribe - Transcribe audio file`);
  console.log(`  GET /transcripts - List available transcript files`);
  console.log(`  GET /transcript/:filename - Download transcript JSON`);
  console.log(`  GET /health - Health check`);
  console.log(`Screenshots: ${path.join(__dirname, 'screenshots')}`);
  console.log(`Audio files: ${path.join(__dirname, 'audio')}`);
  console.log(`Transcripts: ${path.join(__dirname, 'transcripts')}`);
  console.log(`Results: ${path.join(__dirname, 'results')}`);
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
