import { decodeEntities, stripHtml } from '../domain/text.js';

/**
 * Minimal, dependency-free XML reader for supplier price feeds (YML / price / offers).
 * Handles CDATA, entities, quoted attributes, nested HTML inside <description>
 * and repeated tags (multiple <picture>).
 */

const DEFAULT_BLOCK_NAMES = ['offer', 'item', 'product'];

function findTagEnd(xml, from) {
  let quote = null;
  for (let i = from; i < xml.length; i += 1) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return xml.length;
}

function parseAttributes(source) {
  const attrs = {};
  const regex = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/** Yields text/cdata/open/close tokens. */
export function* tokenize(xml) {
  let i = 0;
  const length = xml.length;
  while (i < length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      if (i < length) yield { type: 'text', value: xml.slice(i) };
      return;
    }
    if (lt > i) yield { type: 'text', value: xml.slice(i, lt) };

    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const stop = end === -1 ? length : end;
      yield { type: 'cdata', value: xml.slice(lt + 9, stop) };
      i = end === -1 ? length : end + 3;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? length : end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? length : end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      i = end === -1 ? length : end + 1;
      continue;
    }

    const gt = findTagEnd(xml, lt + 1);
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (raw.startsWith('/')) {
      yield { type: 'close', name: raw.slice(1).trim().split(/\s+/)[0] };
      continue;
    }
    const nameMatch = raw.match(/^([A-Za-z_][\w:.-]*)/);
    if (!nameMatch) continue;
    yield {
      type: 'open',
      name: nameMatch[1],
      selfClose: raw.trimEnd().endsWith('/'),
      attributes: parseAttributes(raw),
    };
  }
}

function appendChild(block, name, attributes, text) {
  if (!block.children[name]) block.children[name] = [];
  const entry = { attributes, text: text ?? '' };
  block.children[name].push(entry);
  return entry;
}

/**
 * Extracts repeated blocks (offer/item/product) with their direct child tags.
 * @returns {Array<{name: string, attributes: object, children: Record<string, Array<{attributes: object, text: string}>>}>}
 */
export function extractBlocks(xml, blockNames = DEFAULT_BLOCK_NAMES) {
  const wanted = new Set(blockNames);
  const blocks = [];
  let current = null;
  let child = null;
  let nestedDepth = 0;

  for (const token of tokenize(xml)) {
    if (!current) {
      if (token.type === 'open' && wanted.has(token.name)) {
        if (token.selfClose) {
          blocks.push({ name: token.name, attributes: token.attributes, children: {} });
        } else {
          current = { name: token.name, attributes: token.attributes, children: {} };
        }
      }
      continue;
    }

    if (token.type === 'text' || token.type === 'cdata') {
      if (child) {
        const value = token.type === 'cdata' ? token.value : decodeEntities(token.value);
        if (!child.entry) {
          child.entry = appendChild(current, child.name, child.attributes, '');
        }
        child.entry.text += value;
      } else {
        // Text directly inside the block (e.g. <category id="1">Назва</category>).
        current.text = (current.text ?? '') + (token.type === 'cdata' ? token.value : decodeEntities(token.value));
      }
      continue;
    }

    if (token.type === 'open') {
      if (token.name === current.name && nestedDepth === 0) {
        // Malformed feed: block started again before closing the previous one.
        blocks.push(current);
        current = { name: token.name, attributes: token.attributes, children: {} };
        child = null;
        continue;
      }
      if (child && (nestedDepth > 0 || token.name !== child.name)) {
        if (nestedDepth > 0) nestedDepth += 1;
        else nestedDepth = 1;
        continue;
      }
      if (token.selfClose) {
        appendChild(current, token.name, token.attributes, '');
        continue;
      }
      child = { name: token.name, attributes: token.attributes, entry: null };
      continue;
    }

    if (token.type === 'close') {
      if (child) {
        if (nestedDepth > 0) {
          nestedDepth -= 1;
        } else if (token.name === child.name) {
          child = null;
        }
        continue;
      }
      if (token.name === current.name) {
        blocks.push(current);
        current = null;
      }
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

export function childText(block, name) {
  const entry = block.children[name]?.[0];
  return entry ? entry.text.trim() : '';
}

export function childTexts(block, name) {
  return (block.children[name] ?? []).map((entry) => entry.text.trim()).filter(Boolean);
}

export function childEntries(block, name) {
  return block.children[name] ?? [];
}

export function hasChild(block, name) {
  return Boolean(block.children[name]?.length);
}

export function cleanFeedText(value) {
  return stripHtml(decodeEntities(value ?? '')).trim();
}
