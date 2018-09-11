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
import * as common from './lib/common';
import * as util from './lib/util';


const META_GROUP_NAME = '___CONTRAST___';
const TEXT_LAYER_PREDICATE = NSPredicate.predicateWithFormat('className == %@', 'MSTextLayer');


export default function(context) {
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

  let contrastMetaGroup = artboard.layers().find(layer => layer.name() == META_GROUP_NAME);
  if (contrastMetaGroup) {
    contrastMetaGroup.removeFromParent();
    return;
  }

  let artboardCopy = artboard.copy();
  context.document.currentPage().addLayer(artboardCopy);

  try {
    let visibleTextLayerInfos = findVisibleTextLayerInfos(artboardCopy);
    visibleTextLayerInfos.forEach(({layer}) => layer.setIsVisible(false));
    let metaGroup = MSLayerGroup.new();
    metaGroup.setName(META_GROUP_NAME);
    artboardCopy.addLayer(metaGroup);
    let {image} = util.getArtboardImage(context.document, artboardCopy);
    let bitmapImageRep = NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation());
    for (let {layer, opacity, rectangle} of visibleTextLayerInfos) {
      let {x,y,w,h} = rectangle;
      let {status} = getTypeContrastRating(layer, opacity, rectangle, bitmapImageRep);
      let rectShape = MSRectangleShape.alloc().init();
      rectShape.frame = MSRect.rectWithRect(NSMakeRect(x, y, w, h));
      let fillLayer = MSShapeGroup.shapeWithPath(rectShape);
      let fill = fillLayer.style().addStylePartOfType(0);
      if (status == 'pass') {
        fill.color = MSColor.colorWithRed_green_blue_alpha(0, .7, 0, .4);
      } else if (status == 'fail') {
        fill.color = MSColor.colorWithRed_green_blue_alpha(1, 0, 0, .4);
      }
      metaGroup.addLayer(fillLayer);
      // debug
      // let cr = MSTextLayer.new();
      // cr.setTextAlignment(2);
      // cr.setVerticalAlignment(1);
      // cr.setTextBehaviour(2);
      // cr.frame = MSRect.rectWithRect(NSMakeRect(x, y, w, h));
      // cr.setStringValue(t || contrastRatio);
      // metaGroup.addLayer(cr);
    }
    visibleTextLayerInfos.forEach(({layer}) => layer.setIsVisible(true));
    let {path} = util.getArtboardImage(context.document, artboardCopy);
    NSWorkspace.sharedWorkspace().openFile(path);
  } catch (e) {
    throw e;
    // log(e.message);
    // log(e.stack.replace(/(^|\n)/g, '$1  > '));
  }

  artboardCopy.removeFromParent();
}


/**
 * Computes the AA contrast rating (pass/fail) for the given text layer, at the given
 * opacity, using the background determined by the given rectangular cutout of the given
 * NSBitmapImageRep.
 */
function getTypeContrastRating(textLayer, opacity, {x, y, w, h}, bitmapImageRep) {
  let samplePoints = [
    [x, y]
  ];
  let textStyleAttr = textLayer.style().textStyle().attributes();
  let textMSImmColor = textStyleAttr.MSAttributedStringColorAttribute;
  let textColor = {
    r: Math.round(255 * textMSImmColor.red()),
    g: Math.round(255 * textMSImmColor.green()),
    b: Math.round(255 * textMSImmColor.blue()),
    a: Math.round(255 * textMSImmColor.alpha()),
  };

  let pointSize = textStyleAttr.NSFont.pointSize() / 1.333333333; // CSS px -> pt
  let isBold = /(medium|bold|black)/i.test(textStyleAttr.NSFont.fontName());
  let largeText = pointSize >= 18 || (isBold && pointSize >= 14);
  let passingContrastForLayer = largeText ? 3 : 4.5;

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
    if (contrastRatio < passingContrastForLayer) {
      return {status: 'fail', contrastRatio: contrastRatio.toFixed(2) + ':1'};
    } else {
      return {status: 'pass', contrastRatio: contrastRatio.toFixed(2) + ':1'};
    }
  }

  return {status: 'pass', contrastRatio: 'NA'};
}


/**
 * Deep-search for visible MSTextLayers in the given parent layer, returning an array
 * containing the layer, its frame rectangle, and effective opacity.
 */
function findVisibleTextLayerInfos(parent) {
  let visibleTextLayers = common.getAllLayersMatchingPredicate(
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

  let symbolInstances = common.getAllLayersMatchingPredicate(
      parent,
      NSPredicate.predicateWithFormat('className == %@', 'MSSymbolInstance'))
      .filter(symbolInstance => doesSymbolInstanceHaveTextLayers(symbolInstance));
  for (let symbolInstance of symbolInstances) {
    // symbol instance has flows inside it; make a copy of it,
    // detach it to a group, find the hotspots, and then kill the copy
    symbolInstance = symbolInstance.detachByReplacingWithGroup();
    visibleTextLayerInfos = [...visibleTextLayerInfos, ...findVisibleTextLayerInfos(symbolInstance)];
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
  if (common.getAllLayersMatchingPredicate(
    symbolInstance.symbolMaster(),
    TEXT_LAYER_PREDICATE).length) {
    return true;
  }

  // check for symbol instance children that have flows
  let symbolInstances = common.getAllLayersMatchingPredicate(
      symbolInstance.symbolMaster(),
      NSPredicate.predicateWithFormat('className == %@', 'MSSymbolInstance'));
  for (let symbolInstance of symbolInstances) {
    if (doesSymbolInstanceHaveTextLayers(symbolInstance)) {
      return true;
    }
  }

  return false;
}
