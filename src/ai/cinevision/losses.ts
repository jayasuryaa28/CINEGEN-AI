import * as tf from "@tensorflow/tfjs";

/**
 * CINEVISION Multi-Task Loss Functions
 *
 * Mathematical Formulations:
 *
 * 1. Corner Loss (Smooth L1 / Huber):
 *    L_corners = Huber(P_corners, Y_corners, delta = 0.05)
 *    Penalizes deviations in the 4 predicted corner coordinates while resisting outlier noise.
 *
 * 2. Homography Loss (Mean Squared Error):
 *    L_homo = 1/8 * sum_{i=1}^8 (H_pred_i - H_gt_i)^2
 *    Enforces accurate projection matrix parameter alignment.
 *
 * 3. Motion Loss (Mean Squared Error on Frame Displacements):
 *    L_motion = ||dx_pred - dx_gt||^2 + ||dy_pred - dy_gt||^2
 *
 * 4. Occlusion Loss (Binary Cross-Entropy & Area L1):
 *    L_occlusion = BCE(p_occ, y_occ) + |area_pred - area_gt|
 *
 * 5. Quality Estimation Loss (Mean Absolute Error):
 *    L_quality = 1/4 * sum_{k=1}^4 |Q_pred_k - Q_gt_k|
 *
 * Multi-Task Objective:
 *    L_total = w1*L_corners + w2*L_homo + w3*L_motion + w4*L_occlusion + w5*L_quality
 */

export interface CineVisionLossWeights {
  corners: number;
  homography: number;
  motion: number;
  occlusion: number;
  quality: number;
  mask?: number;
}

export function calculateCineVisionLosses(
  predictions: tf.Tensor[],
  targets: {
    corners: tf.Tensor;
    homography: tf.Tensor;
    motion: tf.Tensor;
    occlusion: tf.Tensor;
    quality: tf.Tensor;
    occlusionMask?: tf.Tensor;
  },
  weights: CineVisionLossWeights = {
    corners: 2.0,
    homography: 0.5,
    motion: 1.0,
    occlusion: 1.0,
    quality: 1.0,
    mask: 1.5,
  }
): {
  totalLoss: tf.Scalar;
  cornerLoss: tf.Scalar;
  homoLoss: tf.Scalar;
  motionLoss: tf.Scalar;
  occlusionLoss: tf.Scalar;
  qualityLoss: tf.Scalar;
  maskLoss?: tf.Scalar;
} {
  const [predCorners, predHomo, predMotion, predOcclusion, predQuality, predMask] = predictions;

  // 1. Corner Smooth L1 Loss (Huber with delta = 0.05)
  const cornerLoss = tf.losses.huberLoss(
    targets.corners,
    predCorners,
    undefined,
    0.05
  ) as tf.Scalar;

  // 2. Homography MSE Loss
  const homoLoss = tf.losses.meanSquaredError(
    targets.homography,
    predHomo
  ) as tf.Scalar;

  // 3. Motion MSE Loss
  const motionLoss = tf.losses.meanSquaredError(
    targets.motion,
    predMotion
  ) as tf.Scalar;

  // 4. Occlusion BCE & L1 Loss
  const occBce = tf.losses.sigmoidCrossEntropy(
    targets.occlusion.slice([0, 0], [-1, 1]),
    predOcclusion.slice([0, 0], [-1, 1])
  ) as tf.Scalar;
  const occAreaL1 = tf.mean(
    tf.abs(
      tf.sub(
        predOcclusion.slice([0, 1], [-1, 1]),
        targets.occlusion.slice([0, 1], [-1, 1])
      )
    )
  ) as tf.Scalar;
  const occlusionLoss = tf.add(occBce, occAreaL1) as tf.Scalar;

  // 5. Quality MAE Loss
  const qualityLoss = tf.mean(tf.abs(tf.sub(predQuality, targets.quality))) as tf.Scalar;

  // 6. Spatial Occlusion Segmentation Mask Loss (BCE + Soft Dice)
  let maskLoss: tf.Scalar | undefined;
  let weightedLoss = tf.add(
    tf.mul(weights.corners, cornerLoss),
    tf.add(
      tf.mul(weights.homography, homoLoss),
      tf.add(
        tf.mul(weights.motion, motionLoss),
        tf.add(
          tf.mul(weights.occlusion, occlusionLoss),
          tf.mul(weights.quality, qualityLoss)
        )
      )
    )
  ) as tf.Scalar;

  if (predMask && targets.occlusionMask) {
    // BCE Loss
    const bce = tf.losses.sigmoidCrossEntropy(targets.occlusionMask, predMask) as tf.Scalar;
    // Soft Dice Loss
    const intersection = tf.sum(tf.mul(predMask, targets.occlusionMask));
    const union = tf.add(tf.sum(predMask), tf.sum(targets.occlusionMask));
    const dice = tf.sub(1.0, tf.div(tf.mul(2.0, intersection), tf.add(union, 1e-5))) as tf.Scalar;
    maskLoss = tf.add(bce, dice) as tf.Scalar;
    weightedLoss = tf.add(weightedLoss, tf.mul(weights.mask ?? 1.5, maskLoss)) as tf.Scalar;
  }

  return {
    totalLoss: weightedLoss,
    cornerLoss,
    homoLoss,
    motionLoss,
    occlusionLoss,
    qualityLoss,
    maskLoss,
  };
}
