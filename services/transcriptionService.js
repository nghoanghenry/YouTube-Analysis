const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

class TranscriptionService {
  constructor() {
    this.client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY
    });
    this.transcriptsDir = path.join(__dirname, '..', 'transcripts');
    this.ensureTranscriptsDir();
  }

  async ensureTranscriptsDir() {
    try {
      await fs.mkdir(this.transcriptsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating transcripts directory:', error);
    }
  }

  async transcribeAudioFile(audioPath) {
    try {
      console.log(`Starting transcription for: ${audioPath}`);

      // Read the audio file
      const fullPath = path.join(__dirname, '..', audioPath.replace(/^\//, ''));
      const audioBuffer = await fs.readFile(fullPath);
      
      const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });

      // Send to ElevenLabs Scribe
      const transcription = await this.client.speechToText.convert({
        file: audioBlob,
        modelId: "scribe_v1",
        tagAudioEvents: true,
        languageCode: "eng",
        diarize: true,
        outputFormat: "json"
      });

      console.log('Transcription completed successfully');
      
      const result = {
        success: true,
        transcription: transcription,
        timestamp: new Date().toISOString(),
        audioFile: audioPath
      };

      // Process through ZeroGPT for AI detection
      const enhancedResult = await this.processTranscriptWithAI(result);
      
      await this.saveTranscriptToFile(enhancedResult, audioPath);

      return enhancedResult;

    } catch (error) {
      console.error('Transcription error:', error);
      const errorResult = {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        audioFile: audioPath
      };
      
      await this.saveTranscriptToFile(errorResult, audioPath);
      
      return errorResult;
    }
  }

  async transcribeFromUrl(audioUrl) {
    try {
      console.log(`Starting transcription from URL: ${audioUrl}`);

      const { default: fetch } = await import('node-fetch');
      
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.statusText}`);
      }

      const audioBlob = new Blob([await response.arrayBuffer()], { type: "audio/wav" });

      // Send to ElevenLabs Scribe
      const transcription = await this.client.speechToText.convert({
        file: audioBlob,
        modelId: "scribe_v1",
        tagAudioEvents: true,
        languageCode: "eng",
        diarize: true,
        outputFormat: "json"
      });

      console.log('URL transcription completed successfully');
      
      const result = {
        success: true,
        transcription: transcription,
        timestamp: new Date().toISOString(),
        audioUrl: audioUrl
      };

      // Process through ZeroGPT for AI detection
      const enhancedResult = await this.processTranscriptWithAI(result);
      
      await this.saveTranscriptToFile(enhancedResult, audioUrl);

      return enhancedResult;

    } catch (error) {
      console.error('URL transcription error:', error);
      const errorResult = {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        audioUrl: audioUrl
      };
      
      await this.saveTranscriptToFile(errorResult, audioUrl);
      
      return errorResult;
    }
  }

  async checkAIContent(text) {
    try {
      const { default: fetch } = await import('node-fetch');
      
      const response = await fetch('https://api.zerogpt.com/api/detect/detectText', {
        method: 'POST',
        headers: {
          'ApiKey': process.env.ZEROGPT_API_KEY || 'demo-key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input_text: text
        })
      });

      if (!response.ok) {
        console.warn(`ZeroGPT API error: ${response.status}`);
        return { ai_probability: 0, error: 'API error' };
      }

      const result = await response.json();
      console.log('ZeroGPT response:', result);
      
      return {
        ai_probability: result.data?.fakePercentage || 0,
        is_human: result.data?.isHuman || false,
        text_words: result.data?.textWords || 0,
        fake_percentage: result.data?.fakePercentage || 0,
        sentences: result.data?.sentences || []
      };

    } catch (error) {
      console.error('ZeroGPT API error:', error);
      return { ai_probability: 0, error: error.message };
    }
  }

  async processTranscriptWithAI(transcriptionData) {
    if (!transcriptionData.success || !transcriptionData.transcription) {
      return transcriptionData;
    }

    const transcript = transcriptionData.transcription;
    
    // Extract sentences from the transcript
    const sentences = this.extractSentences(transcript.text || '');
    
    console.log(`Processing ${sentences.length} sentences through ZeroGPT...`);
    
    // Process each sentence through ZeroGPT
    const processedSentences = [];
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if (sentence.trim().length > 10) { // Only process meaningful sentences
        console.log(`Processing sentence ${i + 1}/${sentences.length}`);
        const aiAnalysis = await this.checkAIContent(sentence);
        processedSentences.push({
          text: sentence,
          index: i,
          ...aiAnalysis
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const enhancedTranscript = {
      ...transcriptionData,
      ai_analysis: {
        processed_at: new Date().toISOString(),
        total_sentences: sentences.length,
        processed_sentences: processedSentences.length,
        sentences: processedSentences,
        overall_ai_probability: processedSentences.length > 0 
          ? processedSentences.reduce((sum, s) => sum + (s.ai_probability || 0), 0) / processedSentences.length 
          : 0,
        average_fake_percentage: processedSentences.length > 0
          ? processedSentences.reduce((sum, s) => sum + (s.fake_percentage || 0), 0) / processedSentences.length
          : 0
      }
    };

    return enhancedTranscript;
  }

  extractSentences(text) {
    if (!text) return [];
    
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 5);
  }

  async saveTranscriptToFile(transcriptData, source) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      let filename;
      
      if (source.includes('/')) {
        const baseName = path.basename(source, path.extname(source));
        filename = `transcript_${baseName}_${timestamp}.json`;
      } else {
        const sourceHash = Buffer.from(source).toString('base64').slice(0, 8);
        filename = `transcript_${sourceHash}_${timestamp}.json`;
      }

      const filePath = path.join(this.transcriptsDir, filename);
      
      const jsonData = {
        metadata: {
          source: source,
          generated_at: new Date().toISOString(),
          service: 'ElevenLabs Scribe + ZeroGPT',
          format_version: '1.0'
        },
        ...transcriptData
      };

      await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf8');
      console.log(`Transcript saved to: ${filePath}`);
      
      return filePath;
    } catch (error) {
      console.error('Error saving transcript file:', error);
      return null;
    }
  }

  formatTranscription(transcriptionResult) {
    if (!transcriptionResult.success || !transcriptionResult.transcription) {
      return {
        text: '',
        speakers: [],
        events: [],
        error: transcriptionResult.error || 'Transcription failed'
      };
    }

    const { transcription } = transcriptionResult;
    
    return {
      text: transcription.text || '',
      speakers: transcription.speakers || [],
      events: transcription.events || [],
      duration: transcription.duration || 0,
      language: transcription.language || 'eng',
      confidence: transcription.confidence || 0,
      wordCount: transcription.text ? transcription.text.split(' ').length : 0,
      ai_analysis: transcriptionResult.ai_analysis || null
    };
  }
}

module.exports = new TranscriptionService();
