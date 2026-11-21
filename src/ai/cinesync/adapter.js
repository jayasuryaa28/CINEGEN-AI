const { cineSyncEngine } = require("./engine");
const { timelineAnalyzer } = require("./timeline");
const { cineSyncValidator } = require("./validator");

class TrainedCineSync {
  constructor() {
    this.name = "CINESYNC";
    this.status = "active";
  }

  async calculateOffset(videoFrames, audioBuffer) {
    return cineSyncEngine.calculateOffset(videoFrames, audioBuffer);
  }

  async analyzeTimeline(filePath) {
    return timelineAnalyzer.analyzeTimeline(filePath);
  }

  buildSyncPlan(timeline) {
    return cineSyncEngine.buildSyncPlan(timeline);
  }

  calculateChunkBoundaries(totalDuration, targetChunkDuration = 10, fps = 24, sampleRate = 48000) {
    return cineSyncEngine.calculateChunkBoundaries(totalDuration, targetChunkDuration, fps, sampleRate);
  }

  async assembleFinalMedia(options) {
    return cineSyncEngine.assembleFinalMedia(options);
  }

  async validateFinalExport(exportedPath, expectedDuration) {
    return cineSyncValidator.validateFinalExport(exportedPath, expectedDuration);
  }
}

module.exports = {
  TrainedCineSync,
};
