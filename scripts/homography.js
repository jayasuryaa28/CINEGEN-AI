/**
 * Analytical 4-point planar homography solver
 */
function solveHomography(srcPts, dstPts) {
  // srcPts: [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
  // dstPts: [[x'0,y'0], [x'1,y'1], [x'2,y'2], [x'3,y'3]]
  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPts[i];
    const [u, v] = dstPts[i];
    // Row 1: x, y, 1, 0, 0, 0, -u*x, -u*y = u
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    // Row 2: 0, 0, 0, x, y, 1, -v*x, -v*y = v
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  // Gaussian elimination with partial pivoting for 8x8 system
  const n = 8;
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    // Swap rows
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-9) continue;

    for (let j = i; j < n; j++) A[i][j] /= pivot;
    b[i] /= pivot;

    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = A[k][i];
      for (let j = i; j < n; j++) {
        A[k][j] -= factor * A[i][j];
      }
      b[k] -= factor * b[i];
    }
  }

  // b contains [h11, h12, h13, h21, h22, h23, h31, h32]
  return b;
}

module.exports = { solveHomography };

if (require.main === module) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const dst = [[0.05, 0.05], [0.95, 0.02], [0.98, 0.98], [0.02, 0.95]];
  const H = solveHomography(src, dst);
  console.log("Computed H (8 params):", H);

  // Verification: map src[1] = [1, 0]
  const denom = H[6] * 1 + H[7] * 0 + 1;
  const xPred = (H[0] * 1 + H[1] * 0 + H[2]) / denom;
  const yPred = (H[3] * 1 + H[4] * 0 + H[5]) / denom;
  console.log("Target:", dst[1], "Predicted:", [xPred, yPred]);
}
