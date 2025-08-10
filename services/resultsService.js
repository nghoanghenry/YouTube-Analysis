const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ResultsService {
  constructor() {
    this.resultsDir = path.join(__dirname, '..', 'results');
    this.ensureResultsDir();
  }

  async ensureResultsDir() {
    try {
      await fs.mkdir(this.resultsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating results directory:', error);
    }
  }

  async saveResult(analysisData) {
    try {
      const resultId = uuidv4();
      const timestamp = new Date().toISOString();
      
      const result = {
        id: resultId,
        timestamp: timestamp,
        status: 'completed',
        data: analysisData,
        metadata: {
          created_at: timestamp,
          service_version: '1.0',
          processing_time: analysisData.technical?.pageLoadTime || null
        }
      };

      const filePath = path.join(this.resultsDir, `${resultId}.json`);
      await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
      
      console.log(`Result saved with ID: ${resultId}`);
      return resultId;
      
    } catch (error) {
      console.error('Error saving result:', error);
      return null;
    }
  }

  async getResult(resultId) {
    try {
      const filePath = path.join(this.resultsDir, `${resultId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading result:', error);
      return null;
    }
  }

  async listResults() {
    try {
      const files = await fs.readdir(this.resultsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      const results = [];
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.resultsDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const result = JSON.parse(data);
          results.push({
            id: result.id,
            timestamp: result.timestamp,
            status: result.status,
            videoId: result.data?.videoId,
            title: result.data?.title
          });
        } catch (error) {
          console.error(`Error reading result file ${file}:`, error);
        }
      }
      
      return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Error listing results:', error);
      return [];
    }
  }

  async deleteResult(resultId) {
    try {
      const filePath = path.join(this.resultsDir, `${resultId}.json`);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error('Error deleting result:', error);
      return false;
    }
  }
}

module.exports = new ResultsService();
