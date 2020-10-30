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

import UI from 'sketch/ui';
import * as util from './lib/util';


const META_GROUP_NAME = '___CONTRAST___';
const TEXT_LAYER_PREDICATE = NSPredicate.predicateWithFormat('className == %@', 'MSTextLayer');


const Colors = {
  PASS: util.svgColorToMSColor('rgba(0, 178, 0, .4)'),
  FAIL: util.svgColorToMSColor('rgba(255, 0, 0, .4)'),
  UNKNOWN: util.svgColorToMSColor('rgba(255, 213, 79, .4)'),
};


const Mode = {
  IMAGE: 0,
  INLINE: 1,
};


export function onCheckCurrentArtboard(context) {
  if (!context.selection.length) {
    UI.message('Select a layer in an artboard');
    return;
  }

  let artboard = context.selection[0];
  while (artboard && !(artboard instanceof MSArtboardGroup)) {
    artboard = artboard.parentGroup();
  }

  if (!artboard) {
    UI.message('Select a layer in an artboard');
    return;
  }

  let {path} = createContrastReport(context, artboard, {mode: Mode.IMAGE});
  NSWorkspace.sharedWorkspace().openFile(path);
}


export function onCheckAllArtboards(context) {
  let page = context.document.currentPage();
  if (removeInlineContrastReports(page)) {
    return;
  }

  Array.from(page.layers()).filter(l => l instanceof MSArtboardGroup).forEach(a => {
    createContrastReport(context, a, {mode: Mode.INLINE});
  });
}


/**
 * Removes inline contrast reports created by the INLINE mode under the given parent
 * (document, page, or artboard). Returns true if anything was removed.
 */
function removeInlineContrastReports(parent) {
  let contrastMetaGroups = util.getAllLayersMatchingPredicate(
      parent,
      NSPredicate.predicateWithFormat('name == %@', META_GROUP_NAME));
  if (contrastMetaGroups.length) {
    contrastMetaGroups.forEach(g => g.removeFromParent());
    return true;
  }

  return false;
}


/**
 * Creates a contrast report for the given artboard. Mode options are IMAGE,
 * which produces a PNG file report, or INLINE which draws the report in the artboard.
 */
function createContrastReport(context, artboard, {mode = Mode.IMAGE} = {}) {
  let artboardCopy = artboard.copy();
  context.document.currentPage().addLayer(artboardCopy);

  let visibleTextLayerInfos = findVisibleTextLayerInfos(artboardCopy);
  visibleTextLayerInfos.forEach(({layer}) => layer.setIsVisible(false));
  let metaGroup = MSLayerGroup.new();
  metaGroup.setName(META_GROUP_NAME);
  if (mode == Mode.IMAGE) {
    artboardCopy.addLayer(metaGroup);
  } else {
    artboard.addLayer(metaGroup);
  }
  let {image} = util.getArtboardImage(context.document, artboardCopy);
  let bitmapImageRep = NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation());
  for (let {layer, opacity, rectangle} of visibleTextLayerInfos) {
    let rating = getTypeContrastRating(
        layer, opacity, rectangle, bitmapImageRep);
        renderContrastReportOverlay(metaGroup, rectangle, rating);
  }
  visibleTextLayerInfos.forEach(({layer}) => layer.setIsVisible(true));
  let returnValue = {};
  if (mode == Mode.IMAGE) {
    returnValue = util.getArtboardImage(context.document, artboardCopy);
  }

  artboardCopy.removeFromParent();
  return returnValue;
}


/**
 * Renders a contrast report overlay at the given coordinates (pass/fail, etc)
 */
function renderContrastReportOverlay(metaGroup, {x, y, w, h}, {contrastRatio, note, status}) {
  let overlayText = note;
  let fillLayer = MSShapeGroup.shapeWithRect(NSMakeRect(x, y, w, h));
  let fill = fillLayer.style().addStylePartOfType(util.StylePartType.FILL);
  switch (status) {
    case 'pass':
      fill.color = Colors.PASS;
      break;
    case 'fail':
      fill.color = Colors.FAIL;
      overlayText = formatContrastRatio(contrastRatio);
      break;
    case 'unknown':
    case 'mixed':
      fill.color = Colors.UNKNOWN;
      break;
  }
  metaGroup.addLayer(fillLayer);
  if (overlayText) {
    let overlayTextLayer = MSTextLayer.new();
    overlayTextLayer.setStringValue(overlayText);
    if (w < 100) {
      let delta = (100 - w);
      x -= delta / 2;
      w = 100;
    }
    overlayTextLayer.frame = MSRect.rectWithRect(NSMakeRect(x, y, w, h));
    overlayTextLayer.setTextBehaviour(2); // fixed
    overlayTextLayer.setTextAlignment(2); // center
    overlayTextLayer.setVerticalAlignment(1); // center
    overlayTextLayer.setFont(NSFont.boldSystemFontOfSize(10));
    overlayTextLayer.setTextColor(util.svgColorToMSColor('#fff'));
    let shadow = overlayTextLayer.style().addStylePartOfType(util.StylePartType.SHADOW);
    shadow.offsetX = 0;
    shadow.offsetY = 1;
    shadow.blurRadius = 1;
    shadow.color = util.svgColorToMSColor('rgba(0,0,0,0.5)');
    metaGroup.addLayer(overlayTextLayer);
  }
}


/**
 * Takes a number like 5.561236 and formats it as a contrast ratio like 5.57:1
 */
function formatContrastRatio(contrastRatio) {
  return isNaN(contrastRatio) ? 'NA' : contrastRatio.toFixed(2) + ':1';
}


/**
 * Computes the AA contrast rating (pass/fail) for the given text layer, at the given
 * opacity, using the background determined by the given rectangular cutout of the given
 * NSBitmapImageRep.
 */
function getTypeContrastRating(textLayer, opacity, {x, y, w, h}, bitmapImageRep) {
  let samplePoints = [
    // TODO: adaptive sampling?
    [x, y],
    // as of last testing, runtime diff. sampling 4 vs. 1 points only took ~5% longer
    [x + w - 1, y],
    [x, y + h - 1],
    [x + h - 1, y + h - 1],
  ];

  let textStyleAttr = textLayer.style().textStyle().attributes();
  let textMSColor = textStyleAttr.MSAttributedStringColorAttribute; // actually an MSImmutableColor
  if (!textMSColor) {
    let names = [];
    let parent = textLayer;
    while (parent) {
      names.unshift(parent.name());
      parent = parent.parentGroup();
    }
    log(`Can't get text color for text layer ${names.join(' > ')}`);
    return {status: 'unknown', contrastRatio: 'NA'};
  }

  // check for tints (fill styles on parent layers that override the text color)
  let parent = textLayer.parentGroup();
  while (parent) {
    let fills = Array.from(parent.style().stylePartsOfType(util.StylePartType.FILL));
    if (fills.length) {
      for (let fill of fills) {
        textMSColor = fill.color();
        console.log(`FILL: ${fill.color()} ` + parent.name());
      }
    }
    parent = parent.parentGroup();
  }

  let textColor = {
    r: Math.round(255 * textMSColor.red()),
    g: Math.round(255 * textMSColor.green()),
    b: Math.round(255 * textMSColor.blue()),
    a: Math.round(255 * textMSColor.alpha()),
  };

  let pointSize = textStyleAttr.NSFont.pointSize() / 1.333333333; // CSS px -> pt
  let isBold = /(medium|bold|black)/i.test(textStyleAttr.NSFont.fontName());
  let largeText = pointSize >= 18 || (isBold && pointSize >= 14);
  let passingContrastForLayer = largeText ? 3 : 4.5;

  let stats = {fail: 0, pass: 0, minCR: Infinity, maxCR: 0};

  for (let [x_, y_] of samplePoints) {
    let bgNSColor = bitmapImageRep.colorAtX_y_(x_, y_);
    if (!bgNSColor) {
      // likely this sample point is out of bounds
      continue;
    }

    let bgColor = {
      r: Math.round(255 * bgNSColor.redComponent()),
      g: Math.round(255 * bgNSColor.greenComponent()),
      b: Math.round(255 * bgNSColor.blueComponent()),
      a: Math.round(255 * bgNSColor.alphaComponent()),
    };

    let blendedTextColor = util.mixColors(bgColor, textColor,
        (textColor.a * opacity) / 255 * 100);

    let lum1 = util.srgbLuminance(blendedTextColor);
    let lum2 = util.srgbLuminance(bgColor);
    let contrastRatio = (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
    stats.minCR = Math.min(stats.minCR, contrastRatio);
    stats.maxCR = Math.max(stats.maxCR, contrastRatio);
    if (contrastRatio < passingContrastForLayer) {
      ++stats.fail;
    } else {
      ++stats.pass;
    }
  }

  if (stats.fail > 0 && stats.pass > 0) {
    return {
      status: 'mixed',
      contrastRatio: stats.minCR,
      note: formatContrastRatio(stats.minCR) + ' - ' + formatContrastRatio(stats.maxCR),
    };
  } else if (stats.fail > 0) {
    return { status: 'fail', contrastRatio: stats.minCR };
  } else if (stats.pass > 0) {
    return { status: 'pass', contrastRatio: stats.minCR };
  } else {
    return { status: 'unknown', contrastRatio: 0 };
  }
}


/**
 * Deep-search for visible MSTextLayers in the given parent layer, returning an array
 * containing the layer, its frame rectangle, and effective opacity.
 *
 * Has side effects! Will detach symbols.
 */
function findVisibleTextLayerInfos(parent) {
  let visibleTextLayers = util.getAllLayersMatchingPredicate(
      parent,
      TEXT_LAYER_PREDICATE);

  visibleTextLayers = visibleTextLayers.filter(layer => {
    while (layer && layer !== parent) {
      if (!layer.isVisible()) {
        return false;
      }
      layer = layer.parentGroup();
    }

    return true;
  });

  let visibleTextLayerInfos = visibleTextLayers.map(layer => {
    let frame = layer.frame();
    let rectangle = { x: frame.x(), y: frame.y(), w: frame.width(), h: frame.height() };
    let parent = layer.parentGroup();
    let opacity = 1;
    while (parent && !(parent instanceof MSArtboardGroup || parent instanceof MSSymbolMaster)) {
      rectangle.x += parent.frame().x();
      rectangle.y += parent.frame().y();
      opacity *= parent.style().contextSettings().opacity();
      parent = parent.parentGroup();
    }

    return {
      layer,
      opacity,
      rectangle
    };
  });

  let symbolInstances = util.getAllLayersMatchingPredicate(
      parent,
      NSPredicate.predicateWithFormat('className == %@', 'MSSymbolInstance'))
      .filter(symbolInstance => doesSymbolInstanceHaveTextLayers(symbolInstance));
  for (let symbolInstance of symbolInstances) {
    // symbol instance has text layers; detach it to a group to allow hiding them
    // before doing that, see if the symbol includes its background in instances
    let master = symbolInstance.symbolMaster();
    let frame = symbolInstance.frame();
    let bgColor = (master && master.includeBackgroundColorInInstance())
        ? master.backgroundColor() : null;
    let detachedSymbol;
    if (symbolInstance.detachStylesAndReplaceWithGroupRecursively) {
      detachedSymbol = symbolInstance.detachStylesAndReplaceWithGroupRecursively(true);
    } else {
      detachedSymbol = symbolInstance.detachByReplacingWithGroup();
    }
    visibleTextLayerInfos = [
      ...visibleTextLayerInfos,
      ...findVisibleTextLayerInfos(detachedSymbol)
    ];
    if (bgColor) {
      let bgLayer = MSShapeGroup.shapeWithRect(
          NSMakeRect(frame.x(), frame.y(), frame.width(), frame.height()));
      let fill = bgLayer.style().addStylePartOfType(util.StylePartType.FILL);
      fill.color = bgColor;
      detachedSymbol.parentGroup().insertLayer_beforeLayer_(bgLayer, detachedSymbol);
    }
  }

  return visibleTextLayerInfos;
}


/**
 * Returns true if the given MSSymbolInstance contains text layers
 */
function doesSymbolInstanceHaveTextLayers(symbolInstance) {
  if (!symbolInstance.symbolMaster()) {
    return true; // just in case
  }

  // TODO: cache true/false for a given master
  if (util.getAllLayersMatchingPredicate(
    symbolInstance.symbolMaster(),
    TEXT_LAYER_PREDICATE).length) {
    return true;
  }

  // check for symbol instance children that have text layers
  let symbolInstances = util.getAllLayersMatchingPredicate(
      symbolInstance.symbolMaster(),
      NSPredicate.predicateWithFormat('className == %@', 'MSSymbolInstance'));
  for (let symbolInstance of symbolInstances) {
    if (doesSymbolInstanceHaveTextLayers(symbolInstance)) {
      return true;
    }
  }

  return false;
}
