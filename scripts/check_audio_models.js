const tf = require("@tensorflow/tfjs");
const {
  buildNoiseNetModel,
  buildEchoNetModel,
  buildStemNetModel,
  buildVoiceNetModel,
} = require("../src/ai/audio/models");

console.log("=== CHECKING AUDIO NEURAL ARCHITECTURES ===");

const nNet = buildNoiseNetModel(16);
console.log(`✓ NOISENET built: ${nNet.countParams().toLocaleString()} parameters`);

const eNet = buildEchoNetModel(16);
console.log(`✓ ECHONET  built: ${eNet.countParams().toLocaleString()} parameters`);

const sNet = buildStemNetModel(16);
console.log(`✓ STEMNET  built: ${sNet.countParams().toLocaleString()} parameters (3 output heads)`);

const vNet = buildVoiceNetModel(16);
console.log(`✓ VOICENET built: ${vNet.countParams().toLocaleString()} parameters`);

// Check dummy inference on all 4 models with [1, 126, 129, 1] input
const dummy = tf.randomUniform([1, 126, 129, 1]);

const nOut = nNet.predict(dummy);
console.log(`✓ NOISENET output shape: [${nOut.shape.join(", ")}]`);

const eOut = eNet.predict(dummy);
console.log(`✓ ECHONET  output shape: [${eOut.shape.join(", ")}]`);

const sOut = sNet.predict(dummy);
console.log(`✓ STEMNET  output shapes: ${sOut.map(t => `[${t.shape.join(", ")}]`).join(", ")}`);

const vOut = vNet.predict(dummy);
console.log(`✓ VOICENET output shape: [${vOut.shape.join(", ")}]`);

tf.dispose([dummy, nOut, eOut, ...sOut, vOut, nNet, eNet, sNet, vNet]);
console.log("🎉 All 4 Audio Neural Networks verified successfully!");
