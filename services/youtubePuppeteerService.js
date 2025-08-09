const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class YouTubePuppeteerService {
  constructor() {
    this.browser = null;
    this.screenshotsDir = path.join(__dirname, '..', 'screenshots');
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.screenshotsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating screenshots directory:', error);
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
          '--disable-gpu'
        ]
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
      const thumbnails = this.generateThumbnails(videoId);

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
