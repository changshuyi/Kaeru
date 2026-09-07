export function compressImage(file, maxSide = 1000, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      compressImageSrc(reader.result, maxSide, quality).then(resolve, reject);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 跟 compressImage 一樣的縮圖／壓縮邏輯，但吃任意可載入的圖片來源
// （dataURL、blob URL、Capacitor 的 webPath...），相簿多選跟掃描結果都靠這個。
export function compressImageSrc(src, maxSide = 1000, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    // 這裡曾經設 img.crossOrigin = 'anonymous'——那是為了避免畫到
    // canvas 上的圖是「真的跨來源」時 toDataURL 被瀏覽器擋掉
    // （tainted canvas）。但這個函式實際餵進來的來源只有兩種：data:
    // URL（FileReader/掃描結果，本來就不算跨來源）跟 Capacitor 原生端
    // 給的本機檔案路徑（相簿/相機的 webPath、uri）——後者對 WebView
    // 來說本來就算同來源，設了 crossOrigin 反而可能讓某些機型/WebView
    // 版本直接讀取失敗（onerror 被觸發），這個函式的呼叫端（相簿多選
    // 時「第一張以外」的照片、OCR 前置轉檔）都用 try/catch 靜默吞掉
    // 失敗，使用者只會發現「選了 3 張卻只存進 2 張」，完全看不出原因。
    // 拿掉這行——目前所有呼叫情境都不需要它，只有壞處沒有好處。
    img.src = src;
  });
}

// 4 角透視校正：把來源影像中一個（可能歪斜的）四邊形裁出來拉正成矩形。
// 做法是把四邊形切成兩個三角形，各自求出對應輸出三角形的仿射矩陣，
// clip 之後用該矩陣畫整張圖——標準的「canvas 三角貼圖」技巧，不需要 WebGL。
export function solveAffine(src3, dst3) {
  // 解兩個共用係數矩陣的 3x3 線性方程式（x 分量、y 分量分別求）
  const [[x0, y0], [x1, y1], [x2, y2]] = src3;
  const det =
    x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
  if (Math.abs(det) < 1e-6) return null;
  const solveFor = (X0, X1, X2) => {
    // Cramer's rule：a*x+c*y+e=X 對三個點列聯立
    const a =
      (X0 * (y1 - y2) - y0 * (X1 - X2) + (X1 * y2 - X2 * y1)) / det;
    const c =
      (x0 * (X1 - X2) - X0 * (x1 - x2) + (x1 * X2 - x2 * X1)) / det;
    const e =
      (x0 * (y1 * X2 - y2 * X1) -
        y0 * (x1 * X2 - x2 * X1) +
        X0 * (x1 * y2 - x2 * y1)) /
      det;
    return [a, c, e];
  };
  const [a, c, e] = solveFor(dst3[0][0], dst3[1][0], dst3[2][0]);
  const [b, d, f] = solveFor(dst3[0][1], dst3[1][1], dst3[2][1]);
  return [a, b, c, d, e, f];
}

export function perspectiveCrop(img, corners, outW, outH) {
  // corners: [TL, TR, BR, BL]，每個是 {x,y}（原圖像素座標）
  const [TL, TR, BR, BL] = corners;
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext('2d');
  const tris = [
    { src: [TL, TR, BL], dst: [[0, 0], [outW, 0], [0, outH]] },
    { src: [TR, BR, BL], dst: [[outW, 0], [outW, outH], [0, outH]] },
  ];
  for (const tri of tris) {
    const m = solveAffine(
      tri.src.map((p) => [p.x, p.y]),
      tri.dst,
    );
    if (!m) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(tri.dst[0][0], tri.dst[0][1]);
    ctx.lineTo(tri.dst[1][0], tri.dst[1][1]);
    ctx.lineTo(tri.dst[2][0], tri.dst[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  return c;
}

export function rotateCanvas(src, deg) {
  if (!deg) return src;
  const swapped = deg === 90 || deg === 270;
  const c = document.createElement('canvas');
  c.width = swapped ? src.height : src.width;
  c.height = swapped ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// 放大檢視的「旋轉」要真的改到存起來的照片，不是只轉螢幕上的畫面，
// 不然關掉再打開又轉回去，使用者會覺得沒生效。
export function rotateImageSrc(src, deg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const rotated = rotateCanvas(c, deg);
      resolve(rotated.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = src;
  });
}

export function applyContrast(canvas, amount = 35) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const factor = (259 * (amount + 255)) / (255 * (259 - amount));
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(factor * (d[i] - 128) + 128);
    d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128);
    d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128);
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}
