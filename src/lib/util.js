/**
 * Calculates the luminance of the given RGB color.
 */
export function srgbLuminance({r, g, b}) {
  // from tinycolor
  // https://github.com/bgrins/TinyColor/blob/master/tinycolor.js#L75
  // http://www.w3.org/TR/2008/REC-WCAG20-20081211/#relativeluminancedef
  let RsRGB, GsRGB, BsRGB, R, G, B;
  RsRGB = r / 255;
  GsRGB = g / 255;
  BsRGB = b / 255;

  if (RsRGB <= 0.03928) {R = RsRGB / 12.92;} else {R = Math.pow(((RsRGB + 0.055) / 1.055), 2.4);}
  if (GsRGB <= 0.03928) {G = GsRGB / 12.92;} else {G = Math.pow(((GsRGB + 0.055) / 1.055), 2.4);}
  if (BsRGB <= 0.03928) {B = BsRGB / 12.92;} else {B = Math.pow(((BsRGB + 0.055) / 1.055), 2.4);}
  return (0.2126 * R) + (0.7152 * G) + (0.0722 * B);
}


/**
 * Mixes the given colors (RGB dicts) at the given amount (0 to 100).
 */
export function mixColors(c1, c2, amount) {
  // from tinycolor
  // https://github.com/bgrins/TinyColor/blob/master/tinycolor.js#L701
  amount = (amount === 0) ? 0 : (amount || 50);

  let p = amount / 100;

  return {
    r: ((c2.r - c1.r) * p) + c1.r,
    g: ((c2.g - c1.g) * p) + c1.g,
    b: ((c2.b - c1.b) * p) + c1.b,
    // a: ((c2.a - c1.a) * p) + c1.a
  };
}


/**
 * Saves the given artboard to a temporary PNG file and returns the path and an NSImage
 */
export function getArtboardImage(document, artboard) {
  let tempPath = NSTemporaryDirectory().stringByAppendingPathComponent(
      NSUUID.UUID().UUIDString() + '.png');
  // let frame = artboard.frame();
  // let rect = NSMakeRect(frame.origin.x, frame.origin.y, frame.size.width, frame.size.height);
  let exportRequest = MSExportRequest.exportRequestsFromLayerAncestry_(
      MSImmutableLayerAncestry.ancestryWithMSLayer_(artboard),
      // rect // we pass this to avoid trimming
      ).firstObject();
  exportRequest.format = 'png';
  document.saveArtboardOrSlice_toFile_(exportRequest, tempPath);
  return {
    path: tempPath,
    image: NSImage.alloc().initWithContentsOfFile(tempPath)
  };
}