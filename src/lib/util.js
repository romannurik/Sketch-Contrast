/*
 * Copyright 2018 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


export const StylePartType = {
  FILL: 0,
  // BORDER: 1 ?
  SHADOW: 2,
  INNER_SHADOW: 3,
};


/**
 * Returns the first layer matching the given NSPredicate
 *
 * @param {MSDocument|MSLayerGroup} parent The document or layer group to search.
 * @param {NSPredicate} predicate Search predicate
 */
export function getAllLayersMatchingPredicate(parent, predicate) {
  if (parent instanceof MSDocument) {
    // MSDocument
    return parent.pages().reduce(
        (acc, page) => acc.concat(getAllLayersMatchingPredicate(page, predicate)),
        []);
  }

  // assume MSLayerGroup
  return Array.from(parent.children().filteredArrayUsingPredicate(predicate));
}


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
 * Returns an MSColor for the given SVG color (e.g. #fff or rgba(0,0,0,.5))
 */
export function svgColorToMSColor(svgColor) {
  return MSColor.alloc().initWithImmutableObject_(MSImmutableColor.colorWithSVGString(svgColor));
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
  exportRequest.scale = 1;
  document.saveArtboardOrSlice_toFile_(exportRequest, tempPath);
  return {
    path: tempPath,
    image: NSImage.alloc().initWithContentsOfFile(tempPath)
  };
}


/**
 * Decorator-style function that returns a new function that logs the duration of each
 * call to it.
 */
export function profiled(fn) {
  return function () {
    let start = Number(new Date());
    let retVal = fn.apply(this, arguments);
    let durationMs = Number(new Date()) - start;
    log(fn.name + ': ' + (durationMs > 1000 ? `${(durationMs / 1000).toFixed(2)}s` : durationMs + 'ms'));
    return retVal;
  };
}