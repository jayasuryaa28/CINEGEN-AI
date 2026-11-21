import * as tf from "@tensorflow/tfjs";

/**
 * CINEFRAME Multi-Objective Loss Functions
 *
 * Mathematical Formulations:
 *
 * 1. Charbonnier Reconstruction Loss (Robust L1 Variant):
 *    L_char(Y_hat, Y) = 1/N * sum_{i} sqrt((Y_hat_i - Y_i)^2 + eps^2)
 *    where eps = 1e-3. Penalizes pixel discrepancies while remaining smooth and differentiable at zero.
 *
 * 2. Edge Gradient Preservation Loss:
 *    L_edge(Y_hat, Y) = || nabla_x(Y_hat) - nabla_x(Y) ||_1 + || nabla_y(Y_hat) - nabla_y(Y) ||_1
 *    Preserves sharp object contours, cinematic textures, and prevents over-smoothed plastic appearances.
 *
 * 3. Structural Similarity (SSIM) Loss:
 *    L_ssim(Y_hat, Y) = 1 - SSIM(Y_hat, Y)
 *    Enforces structural luminance, contrast, and correlation consistency.
 *
 * 4. Temporal Consistency Loss:
 *    L_temp = || (Y_hat_t - Y_hat_{t-1}) - (Y_t - Y_{t-1}) ||_1
 *    Penalizes frame-to-frame high-frequency flicker, detail popping, and temporal divergence.
 *
 * Multi-Objective Formulation:
 *    L_total = w_char * L_char + w_edge * L_edge + w_ssim * L_ssim + w_temp * L_temp
 */

export interface CineFrameLossWeights {
  charbonnier: number;
  edge: number;
  ssim: number;
  temporal: number;
}

export function calculateCharbonnierLoss(
  pred: tf.Tensor4D,
  target: tf.Tensor4D,
  epsilon = 1e-3
): tf.Scalar {
  return tf.tidy(() => {
    const diff = tf.sub(pred, target);
    const epsSquared = tf.scalar(epsilon * epsilon);
    return tf.mean(tf.sqrt(tf.add(tf.square(diff), epsSquared))) as tf.Scalar;
  });
}

export function calculateEdgePreservationLoss(
  pred: tf.Tensor4D,
  target: tf.Tensor4D
): tf.Scalar {
  return tf.tidy(() => {
    const [b, h, w, c] = pred.shape;
    if (h < 2 || w < 2) return tf.scalar(0.0);

    // Horizontal finite difference
    const dxP = tf.sub(pred.slice([0, 0, 1, 0], [b, h, w - 1, c]), pred.slice([0, 0, 0, 0], [b, h, w - 1, c]));
    const dxT = tf.sub(target.slice([0, 0, 1, 0], [b, h, w - 1, c]), target.slice([0, 0, 0, 0], [b, h, w - 1, c]));
    const lossDx = tf.mean(tf.abs(tf.sub(dxP, dxT)));

    // Vertical finite difference
    const dyP = tf.sub(pred.slice([0, 1, 0, 0], [b, h - 1, w, c]), pred.slice([0, 0, 0, 0], [b, h - 1, w, c]));
    const dyT = tf.sub(target.slice([0, 1, 0, 0], [b, h - 1, w, c]), target.slice([0, 0, 0, 0], [b, h - 1, w, c]));
    const lossDy = tf.mean(tf.abs(tf.sub(dyP, dyT)));

    return tf.add(lossDx, lossDy) as tf.Scalar;
  });
}

export function calculateSSIMLoss(
  pred: tf.Tensor4D,
  target: tf.Tensor4D
): tf.Scalar {
  return tf.tidy(() => {
    const c1 = 0.0001; // (0.01)^2
    const c2 = 0.0009; // (0.03)^2

    const muX = tf.avgPool(pred, [3, 3], [1, 1], "same");
    const muY = tf.avgPool(target, [3, 3], [1, 1], "same");

    const muX2 = tf.square(muX);
    const muY2 = tf.square(muY);
    const muXY = tf.mul(muX, muY);

    const sigmaX2 = tf.sub(tf.avgPool(tf.square(pred) as tf.Tensor4D, [3, 3], [1, 1], "same"), muX2);
    const sigmaY2 = tf.sub(tf.avgPool(tf.square(target) as tf.Tensor4D, [3, 3], [1, 1], "same"), muY2);
    const sigmaXY = tf.sub(tf.avgPool(tf.mul(pred, target) as tf.Tensor4D, [3, 3], [1, 1], "same"), muXY);

    const numerator = tf.mul(
      tf.add(tf.mul(2.0, muXY), c1),
      tf.add(tf.mul(2.0, sigmaXY), c2)
    );
    const denominator = tf.mul(
      tf.add(tf.add(muX2, muY2), c1),
      tf.add(tf.add(sigmaX2, sigmaY2), c2)
    );

    const ssimMap = tf.div(numerator, tf.maximum(denominator, 1e-7));
    const meanSSIM = tf.mean(ssimMap);

    return tf.sub(tf.scalar(1.0), meanSSIM) as tf.Scalar;
  });
}

export function calculateTemporalConsistencyLoss(
  pred: tf.Tensor4D,
  target: tf.Tensor4D,
  prevPred?: tf.Tensor4D,
  prevTarget?: tf.Tensor4D
): tf.Scalar {
  return tf.tidy(() => {
    if (!prevPred || !prevTarget) {
      return tf.scalar(0.0);
    }
    const dPred = tf.sub(pred, prevPred);
    const dTarget = tf.sub(target, prevTarget);
    return tf.mean(tf.abs(tf.sub(dPred, dTarget))) as tf.Scalar;
  });
}

export function calculateCineFrameLosses(
  pred: tf.Tensor4D,
  target: tf.Tensor4D,
  prevPred?: tf.Tensor4D,
  prevTarget?: tf.Tensor4D,
  weights: CineFrameLossWeights = {
    charbonnier: 1.0,
    edge: 0.3,
    ssim: 0.5,
    temporal: 0.4,
  }
): {
  totalLoss: tf.Scalar;
  charbonnierLoss: tf.Scalar;
  edgeLoss: tf.Scalar;
  ssimLoss: tf.Scalar;
  temporalLoss: tf.Scalar;
} {
  const charbonnierLoss = calculateCharbonnierLoss(pred, target);
  const edgeLoss = calculateEdgePreservationLoss(pred, target);
  const ssimLoss = calculateSSIMLoss(pred, target);
  const temporalLoss = calculateTemporalConsistencyLoss(pred, target, prevPred, prevTarget);

  const totalLoss = tf.add(
    tf.mul(weights.charbonnier, charbonnierLoss),
    tf.add(
      tf.mul(weights.edge, edgeLoss),
      tf.add(
        tf.mul(weights.ssim, ssimLoss),
        tf.mul(weights.temporal, temporalLoss)
      )
    )
  ) as tf.Scalar;

  return {
    totalLoss,
    charbonnierLoss,
    edgeLoss,
    ssimLoss,
    temporalLoss,
  };
}
