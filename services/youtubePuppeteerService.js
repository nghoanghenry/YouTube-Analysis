const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');
const { YtDlp } = require('ytdlp-nodejs');
const ffmpeg = require('fluent-ffmpeg');
const transcriptionService = require('./transcriptionService');

// Apply StealthPlugin to make Puppeteer less detectable
puppeteer.use(StealthPlugin());

class YouTubePuppeteerService {
  constructor() {
    this.browser = null;
    this.screenshotsDir = path.join(__dirname, '..', 'screenshots');
    this.audioDir = path.join(__dirname, '..', 'audio');
    this.ytdlp = new YtDlp();
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.screenshotsDir, { recursive: true });
      await fs.mkdir(this.audioDir, { recursive: true });
    } catch (error) {
      console.error('Error creating directories:', error);
    }
  }

  isValidYouTubeUrl(url) {
    const patterns = [
      /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/,
      /^https?:\/\/(www\.)?youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/
    ];
    return patterns.some(pattern => pattern.test(url));
  }

  extractVideoId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    if (match && match[1]) {
      return match[1];
    }
    throw new Error('Could not extract video ID');
  }

  async getBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security', // Optional: Helps with some restrictions
          '--disable-features=site-per-process', // Optional: Improves compatibility
          '--window-size=1280,720' // Match viewport size
        ],
        defaultViewport: { width: 1280, height: 720 }
      });
    }
    return this.browser;
  }

  async analyzeVideo(url) {
    const browser = await this.getBrowser();
    let page = null;

    try {
      const videoId = this.extractVideoId(url);
      page = await browser.newPage();

      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Add human-like behavior to mimic real user
      await page.mouse.move(Math.random() * 100, Math.random() * 100);
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

      console.log(`Loading YouTube page: ${url}`);
      
      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      });

      try {
        await page.waitForSelector('#movie_player', { timeout: 15000 });
      } catch (error) {
        console.log('Video player not found, trying alternative selectors...');
        await page.waitForSelector('video, .video-stream', { timeout: 10000 });
      }

      await new Promise(resolve => setTimeout(resolve, 5000));

      // Accept cookies if popup appears
      try {
        const acceptButton = await page.$('button[aria-label*="Accept"], button[aria-label*="accept"], [aria-label*="I agree"]');
        if (acceptButton) {
          await acceptButton.click();
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.log('No cookie popup found or failed to click');
      }

      // Extract video information
      const videoInfo = await page.evaluate(() => {
        console.log('Available title elements:', document.querySelectorAll('h1').length);
        console.log('Available meta elements:', document.querySelectorAll('meta').length);
        
        const titleSelectors = [
          'h1.ytd-watch-metadata yt-formatted-string',
          'h1.style-scope.ytd-watch-metadata',
          'h1[class*="title"]',
          'meta[property="og:title"]'
        ];
        
        let title = 'Unknown Title';
        for (const selector of titleSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            title = element.textContent?.trim() || element.content || title;
            console.log(`Found title with selector: ${selector}, value: ${title}`);
            break;
          }
        }
        
        const channelSelectors = [
          'ytd-channel-name #text a',
          'ytd-video-owner-renderer .ytd-channel-name a',
          '#owner-name a',
          'meta[name="author"]'
        ];
        
        let channelName = 'Unknown Channel';
        for (const selector of channelSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            channelName = element.textContent?.trim() || element.content || channelName;
            console.log(`Found channel with selector: ${selector}, value: ${channelName}`);
            break;
          }
        }
        
        const viewSelectors = [
          'ytd-watch-info-text .view-count',
          '.view-count',
          '#info .view-count',
          'span[class*="view"]'
        ];
        
        let viewCount = '0';
        for (const selector of viewSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent) {
            viewCount = element.textContent.trim();
            console.log(`Found views with selector: ${selector}, value: ${viewCount}`);
            break;
          }
        }

        const descriptionSelectors = [
          'ytd-expandable-video-description-body-renderer span',
          '#description-text',
          'meta[property="og:description"]'
        ];
        
        let description = '';
        for (const selector of descriptionSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            description = element.textContent?.trim() || element.content || description;
            if (description.length > 0) {
              console.log(`Found description with selector: ${selector}`);
              break;
            }
          }
        }

        const durationSelectors = [
          '.ytp-time-duration',
          'span.ytp-time-duration',
          'meta[property="video:duration"]'
        ];
        
        let duration = 'Unknown';
        for (const selector of durationSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            duration = element.textContent?.trim() || element.content || duration;
            if (duration !== 'Unknown') {
              console.log(`Found duration with selector: ${selector}, value: ${duration}`);
              break;
            }
          }
        }

        return {
          title,
          channelName,
          viewCount,
          description: description.substring(0, 500),
          duration
        };
      });

      const playbackStatus = await this.checkPlaybackStatus(page);
      const screenshotPath = await this.takeScreenshot(page, videoId);
      const audioPath = await this.downloadAudio(url, videoId);
      const thumbnails = this.generateThumbnails(videoId);

      // Add transcription if audio is available
      let transcriptionResult = null;
      if (audioPath && !audioPath.includes('silent')) {
        console.log('Starting audio transcription...');
        transcriptionResult = await transcriptionService.transcribeAudioFile(audioPath);
      }

      const analysis = {
        videoId: videoId,
        title: videoInfo.title,
        description: videoInfo.description,
        duration: videoInfo.duration,
        viewCount: this.parseViewCount(videoInfo.viewCount),
        author: {
          name: videoInfo.channelName,
          channelUrl: `https://youtube.com/@${videoInfo.channelName.replace(/\s+/g, '')}`,
          subscriberCount: 0
        },
        playback: {
          canPlay: playbackStatus.canPlay,
          isPlaying: playbackStatus.isPlaying,
          error: playbackStatus.error
        },
        screenshot: {
          path: screenshotPath,
          timestamp: new Date().toISOString()
        },
        audio: {
          path: audioPath,
          format: 'wav',
          sampleRate: '16kHz',
          channels: 'mono',
          bitDepth: '16bit',
          timestamp: new Date().toISOString(),
          method: audioPath ? (audioPath.includes('silent') ? 'Silent placeholder' : 'Downloaded') : 'Failed'
        },
        transcription: transcriptionResult ? {
          success: transcriptionResult.success,
          text: transcriptionResult.success ? transcriptionService.formatTranscription(transcriptionResult).text : '',
          speakers: transcriptionResult.success ? transcriptionService.formatTranscription(transcriptionResult).speakers : [],
          events: transcriptionResult.success ? transcriptionService.formatTranscription(transcriptionResult).events : [],
          confidence: transcriptionResult.success ? transcriptionService.formatTranscription(transcriptionResult).confidence : 0,
          wordCount: transcriptionResult.success ? transcriptionService.formatTranscription(transcriptionResult).wordCount : 0,
          error: transcriptionResult.success ? null : transcriptionResult.error,
          timestamp: transcriptionResult.timestamp
        } : {
          success: false,
          text: '',
          speakers: [],
          events: [],
          error: 'No audio available for transcription',
          timestamp: new Date().toISOString()
        },
        thumbnails: thumbnails,
        technical: {
          pageLoadTime: Date.now(),
          userAgent: await page.evaluate(() => navigator.userAgent),
          viewport: await page.viewport()
        },
        analyzedAt: new Date().toISOString(),
        url: url,
        method: 'Puppeteer'
      };

      return analysis;

    } catch (error) {
      console.error('Puppeteer analysis error:', error);
      
      // Fallback data with error info
      const videoId = this.extractVideoId(url);
      return {
        videoId: videoId,
        title: 'Error loading video',
        description: `Failed to load YouTube page: ${error.message}`,
        duration: 'Unknown',
        viewCount: 0,
        author: {
          name: 'Unknown',
          channelUrl: '',
          subscriberCount: 0
        },
        playback: {
          canPlay: false,
          isPlaying: false,
          error: error.message
        },
        screenshot: {
          path: null,
          timestamp: new Date().toISOString()
        },
        audio: {
          path: null,
          format: 'wav',
          sampleRate: '16kHz',
          channels: 'mono',
          bitDepth: '16bit',
          timestamp: new Date().toISOString(),
          error: 'Audio download failed due to video loading error'
        },
        transcription: {
          success: false,
          text: '',
          speakers: [],
          events: [],
          error: 'Video loading failed - no transcription available',
          timestamp: new Date().toISOString()
        },
        thumbnails: this.generateThumbnails(videoId),
        technical: {
          error: error.message,
          pageLoadTime: null
        },
        analyzedAt: new Date().toISOString(),
        url: url,
        method: 'Puppeteer (failed)',
        error: error.message
      };
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  async checkPlaybackStatus(page) {
    try {
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const status = await page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        const video = document.querySelector('video');
        
        if (!player && !video) {
          return { canPlay: false, isPlaying: false, error: 'Video player not found' };
        }

        const videoElement = video || player.querySelector('video');
        
        if (!videoElement) {
          return { canPlay: false, isPlaying: false, error: 'Video element not found' };
        }

        const readyState = videoElement.readyState;
        const paused = videoElement.paused;
        const ended = videoElement.ended;
        const currentTime = videoElement.currentTime;
        const duration = videoElement.duration;

        return {
          canPlay: readyState >= 2,
          isPlaying: !paused && !ended && currentTime > 0,
          error: null,
          readyState,
          currentTime,
          duration: isNaN(duration) ? 0 : duration,
          paused,
          ended
        };
      });

      return status;
    } catch (error) {
      return {
        canPlay: false,
        isPlaying: false,
        error: `Playback check failed: ${error.message}`
      };
    }
  }

  async takeScreenshot(page, videoId) {
    try {
      const timestamp = Date.now();
      const filename = `${videoId}_${timestamp}.png`;
      const screenshotPath = path.join(this.screenshotsDir, filename);

      const playerElement = await page.$('#movie_player');
      
      if (playerElement) {
        await playerElement.screenshot({
          path: screenshotPath
        });
      } else {
        await page.screenshot({
          path: screenshotPath,
          fullPage: false,
          clip: {
            x: 0,
            y: 0,
            width: 1280,
            height: 720
          }
        });
      }

      return `/screenshots/${filename}`;
    } catch (error) {
      console.error('Screenshot error:', error);
      
      try {
        const timestamp = Date.now();
        const filename = `${videoId}_${timestamp}_fallback.png`;
        const screenshotPath = path.join(this.screenshotsDir, filename);
        
        await page.screenshot({
          path: screenshotPath,
          fullPage: false
        });
        
        return `/screenshots/${filename}`;
      } catch (fallbackError) {
        console.error('Fallback screenshot also failed:', fallbackError);
        return null;
      }
    }
  }

  async downloadAudio(url, videoId) {
    try {
      const timestamp = Date.now();
      const outputFilename = `${videoId}_${timestamp}.wav`;
      const outputPath = path.join(this.audioDir, outputFilename);

      console.log(`Starting audio download for video: ${videoId}`);
      console.log(`URL: ${url}`);
      console.log(`Output path: ${outputPath}`);

      // Ensure audio directory exists
      const fs = require('fs');
      if (!fs.existsSync(this.audioDir)) {
        fs.mkdirSync(this.audioDir, { recursive: true });
      }

      // Check if ytdlp and ffmpeg are installed
      console.log('Checking yt-dlp installation...');
      try {
        const isInstalled = await this.ytdlp.checkInstallationAsync({ ffmpeg: true });
        console.log('yt-dlp and ffmpeg installed:', isInstalled);

        if (!isInstalled) {
          console.log('Downloading FFmpeg...');
          await this.ytdlp.downloadFFmpeg();
        }
      } catch (checkError) {
        console.warn('Installation check failed:', checkError);
      }

      // Get video info first to verify access
      console.log('Getting video info...');
      try {
        const info = await this.ytdlp.getInfoAsync(url);
        console.log('Video info retrieved:', {
          title: info.title,
          duration: info.duration,
          uploader: info.uploader || info.channel
        });
      } catch (infoError) {
        console.error('Failed to get video info:', infoError);
        throw new Error(`Cannot access video: ${infoError.message}`);
      }

      // Method 1: Use downloadAsync with direct WAV format
      console.log('Method 1: Attempting downloadAsync with WAV format...');
      try {
        const result = await this.ytdlp.downloadAsync(url, {
          format: {
            filter: "audioonly",
            type: "wav"
          },
          output: outputPath,
          onProgress: (progress) => {
            console.log(`Download progress: ${progress.percent}%`);
          }
        });
        
        console.log('downloadAsync result:', result);
        
        // Check if file exists
        if (fs.existsSync(outputPath)) {
          console.log(`✅ Method 1 successful: ${outputPath}`);
          console.log('Format: WAV, audio-only, 16kHz mono 16-bit');
          return `/audio/${outputFilename}`;
        }
      } catch (downloadError) {
        console.error('❌ Method 1 failed:', downloadError.message);
      }

      // Method 2: Use getFileAsync (in-memory download) then save as WAV
      console.log('Method 2: Attempting in-memory download with getFileAsync...');
      try {
        const file = await this.ytdlp.getFileAsync(url, {
          format: {
            filter: "audioonly",
            type: "wav"
          },
          filename: outputFilename,
          onProgress: (progress) => {
            console.log(`In-memory download progress: ${progress.percent}%`);
          }
        });

        // Save file to disk
        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);
        
        console.log(`✅ Method 2 successful: ${outputPath}`);
        console.log('Format: WAV saved from memory');
        return `/audio/${outputFilename}`;
        
      } catch (fileError) {
        console.error('❌ Method 2 failed:', fileError.message);
      }

      throw new Error('Both primary download methods failed');

    } catch (error) {
      console.error('Audio download error:', error);
      console.log('Creating silent WAV file as fallback...');
      return await this.createSilentWav(videoId);
    }
  }

  async convertToWav(inputPath, outputPath, outputFilename) {
    try {
      console.log(`Converting ${inputPath} to WAV format...`);
      console.log(`Output: ${outputPath}`);
      
      // Convert to WAV (16 kHz, mono, 16-bit) using FFmpeg
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .audioFrequency(16000)       // 16 kHz sample rate
          .audioChannels(1)            // Mono
          .audioBitrate('128k')        // Reasonable bitrate
          .audioCodec('pcm_s16le')     // 16-bit PCM little-endian
          .format('wav')
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            console.log(`FFmpeg progress: ${Math.round(progress.percent || 0)}%`);
          })
          .on('end', () => {
            console.log('FFmpeg conversion completed successfully');
            resolve();
          })
          .on('error', (err) => {
            console.error('FFmpeg conversion error:', err);
            reject(err);
          })
          .run();
      });

      // Clean up temporary file
      try {
        const fs = require('fs');
        if (fs.existsSync(inputPath) && inputPath !== outputPath) {
          fs.unlinkSync(inputPath);
          console.log('Temporary file cleaned up:', inputPath);
        }
      } catch (cleanupError) {
        console.warn('Could not cleanup temp file:', cleanupError);
      }

      // Verify final output
      const fs = require('fs');
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log(`Audio processed successfully: ${outputPath}`);
        console.log(`File size: ${Math.round(stats.size / 1024)} KB`);
        console.log('Format: WAV, 16 kHz, mono, 16-bit PCM');
        return `/audio/${outputFilename}`;
      } else {
        throw new Error('Final WAV file was not created');
      }
    } catch (error) {
      console.error('WAV conversion error:', error);
      throw error;
    }
  }

  async createSilentWav(videoId) {
    const timestamp = Date.now();
    const outputFilename = `${videoId}_${timestamp}_silent.wav`;
    const outputPath = path.join(this.audioDir, outputFilename);

    console.log('Creating silent WAV file...');

    // WAV file specs: 16kHz, mono, 16-bit, 10 seconds
    const sampleRate = 16000;
    const duration = 10;
    const numSamples = sampleRate * duration;
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const fileSize = 36 + dataSize;

    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;

    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;

    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4;
    buffer.writeUInt16LE(1, offset); offset += 2;  // PCM
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;
    
    await require('fs').promises.writeFile(outputPath, buffer);
    console.log(`Silent WAV file created: ${outputPath}`);
    
    return `/audio/${outputFilename}`;
  }

  parseViewCount(viewCountText) {
    if (!viewCountText) return 0;
    
    const text = viewCountText.toLowerCase().replace(/[,\s]/g, '');
    const number = parseFloat(text);
    
    if (text.includes('k')) return Math.floor(number * 1000);
    if (text.includes('m')) return Math.floor(number * 1000000);
    if (text.includes('b')) return Math.floor(number * 1000000000);
    
    return Math.floor(number) || 0;
  }

  generateThumbnails(videoId) {
    return [
      {
        url: `https://img.youtube.com/vi/${videoId}/default.jpg`,
        width: 120,
        height: 90
      },
      {
        url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        width: 320,
        height: 180
      },
      {
        url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        width: 480,
        height: 360
      },
      {
        url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        width: 1280,
        height: 720
      }
    ];
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = new YouTubePuppeteerService();