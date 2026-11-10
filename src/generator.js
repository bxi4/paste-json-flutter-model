'use strict';

/**
 * JSON -> Dart (Flutter) model generator.
 * No dependencies; pure functions so it can be unit tested outside VS Code.
 */

const DART_RESERVED = new Set([
  'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export',
  'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'Function',
  'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library',
  'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'set',
  'show', 'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef', 'var',
  'void', 'while', 'with', 'yield', 'hashCode', 'runtimeType', 'toString', 'noSuchMethod',
  'copyWith', 'toJson', 'fromJson', 'json',
]);

function splitWords(str) {
  return String(str)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function pascalCase(str) {
  const words = splitWords(str);
  let out = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  if (!out) out = 'Model';
  if (/^[0-9]/.test(out)) out = 'M' + out;
  return out;
}

function camelCase(str) {
  const p = pascalCase(str);
  let out = p.charAt(0).toLowerCase() + p.slice(1);
  if (DART_RESERVED.has(out)) out = out + 'Value';
  return out;
}

function snakeCase(str) {
  return splitWords(str).map((w) => w.toLowerCase()).join('_') || 'model';
}

function singular(name) {
  if (/ies$/i.test(name)) return name.slice(0, -3) + 'y';
  if (/(ss|us|is)$/i.test(name)) return name;
  if (/(xes|ches|shes|sses)$/i.test(name)) return name.slice(0, -2);
  if (/s$/i.test(name) && name.length > 1) return name.slice(0, -1);
  return name + 'Item';
}

// ---------------------------------------------------------------------------
// Type inference
// Type shapes:
//   { kind: 'prim', dart: 'int'|'double'|'String'|'bool'|'dynamic' }
//   { kind: 'obj', samples: [object, ...] }
//   { kind: 'list', item: Type }
//   { kind: 'null' }
// ---------------------------------------------------------------------------

function inferType(value) {
  if (value === null || value === undefined) return { kind: 'null' };
  if (Array.isArray(value)) {
    let item = { kind: 'null' };
    for (const v of value) item = mergeTypes(item, inferType(v));
    return { kind: 'list', item };
  }
  switch (typeof value) {
    case 'number':
      return { kind: 'prim', dart: Number.isInteger(value) ? 'int' : 'double' };
    case 'string':
      return { kind: 'prim', dart: 'String' };
    case 'boolean':
      return { kind: 'prim', dart: 'bool' };
    case 'object':
      return { kind: 'obj', samples: [value] };
    default:
      return { kind: 'prim', dart: 'dynamic' };
  }
}

function mergeTypes(a, b) {
  if (a.kind === 'null') return b;
  if (b.kind === 'null') return a;
  if (a.kind === 'prim' && b.kind === 'prim') {
    if (a.dart === b.dart) return a;
    const nums = new Set(['int', 'double']);
    if (nums.has(a.dart) && nums.has(b.dart)) return { kind: 'prim', dart: 'double' };
    return { kind: 'prim', dart: 'dynamic' };
  }
  if (a.kind === 'obj' && b.kind === 'obj') return { kind: 'obj', samples: a.samples.concat(b.samples) };
  if (a.kind === 'list' && b.kind === 'list') return { kind: 'list', item: mergeTypes(a.item, b.item) };
  return { kind: 'prim', dart: 'dynamic' };
}

// ---------------------------------------------------------------------------
// Class model building
// ---------------------------------------------------------------------------

function buildClasses(rootName, rootSamples, options) {
  const classes = []; // { name, fields: [{ key, name, type, nullable }] }
  const usedNames = new Set();

  function uniqueName(base) {
    let name = pascalCase(base);
    let i = 2;
    while (usedNames.has(name)) name = pascalCase(base) + i++;
    usedNames.add(name);
    return name;
  }

  function resolve(type, nameHint) {
    if (type.kind === 'null') return { kind: 'prim', dart: 'dynamic' };
    if (type.kind === 'prim') return type;
    if (type.kind === 'list') return { kind: 'list', item: resolve(type.item, singular(nameHint)) };
    // object
    const className = createClass(nameHint, type.samples);
    return { kind: 'obj', className };
  }

  function createClass(nameHint, samples) {
    const name = uniqueName(nameHint);
    const cls = { name, fields: [] };
    classes.push(cls); // push first so parent appears before children

    const keys = [];
    const seen = new Set();
    for (const s of samples) {
      for (const k of Object.keys(s)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }

    const usedFieldNames = new Set();
    for (const key of keys) {
      let merged = { kind: 'null' };
      let missingOrNull = false;
      for (const s of samples) {
        if (!(key in s) || s[key] === null) missingOrNull = true;
        merged = mergeTypes(merged, inferType(s[key]));
      }
      let fieldName = camelCase(key);
      let i = 2;
      while (usedFieldNames.has(fieldName)) fieldName = camelCase(key) + i++;
      usedFieldNames.add(fieldName);

      const type = resolve(merged, key);
      const isDynamic = type.kind === 'prim' && type.dart === 'dynamic';
      cls.fields.push({
        key,
        name: fieldName,
        type,
        nullable: !isDynamic && (options.nullable || missingOrNull),
      });
    }
    return name;
  }

  createClass(rootName, rootSamples);
  return classes;
}

// ---------------------------------------------------------------------------
// Dart code emitters
// ---------------------------------------------------------------------------

function dartType(type) {
  if (type.kind === 'prim') return type.dart;
  if (type.kind === 'obj') return type.className;
  return `List<${dartType(type.item)}>`;
}

function fieldType(f) {
  return dartType(f.type) + (f.nullable ? '?' : '');
}

function containsObject(type) {
  if (type.kind === 'obj') return true;
  if (type.kind === 'list') return containsObject(type.item);
  return false;
}

function fromJsonExpr(type, src, nullable, depth = 0) {
  const q = nullable ? '?' : '';
  if (type.kind === 'prim') {
    if (type.dart === 'dynamic') return src;
    if (type.dart === 'double') return nullable ? `(${src} as num?)?.toDouble()` : `(${src} as num).toDouble()`;
    return `${src} as ${type.dart}${q}`;
  }
  if (type.kind === 'obj') {
    const call = `${type.className}.fromJson(${src} as Map<String, dynamic>)`;
    return nullable ? `${src} == null ? null : ${call}` : call;
  }
  // list
  const v = depth === 0 ? 'e' : `e${depth}`;
  const inner = fromJsonExpr(type.item, v, false, depth + 1);
  return `(${src} as List<dynamic>${q})${q}.map((${v}) => ${inner}).toList()`;
}

function toJsonExpr(type, src, nullable, depth = 0) {
  const q = nullable ? '?' : '';
  if (type.kind === 'prim') return src;
  if (type.kind === 'obj') return `${src}${q}.toJson()`;
  if (!containsObject(type.item)) return src;
  const v = depth === 0 ? 'e' : `e${depth}`;
  return `${src}${q}.map((${v}) => ${toJsonExpr(type.item, v, false, depth + 1)}).toList()`;
}

function emitClass(cls, options) {
  const L = [];
  const n = cls.name;
  L.push(`class ${n} {`);

  // fields
  for (const f of cls.fields) L.push(`  final ${fieldType(f)} ${f.name};`);
  if (cls.fields.length) L.push('');

  // constructor
  if (cls.fields.length === 0) {
    L.push(`  const ${n}();`);
  } else {
    L.push(`  const ${n}({`);
    for (const f of cls.fields) {
      const req = f.nullable || (f.type.kind === 'prim' && f.type.dart === 'dynamic') ? '' : 'required ';
      L.push(`    ${req}this.${f.name},`);
    }
    L.push('  });');
  }
  L.push('');

  // fromJson
  if (cls.fields.length === 0) {
    L.push(`  factory ${n}.fromJson(Map<String, dynamic> json) => const ${n}();`);
  } else {
    L.push(`  factory ${n}.fromJson(Map<String, dynamic> json) => ${n}(`);
    for (const f of cls.fields) {
      const src = `json['${f.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}']`;
      L.push(`        ${f.name}: ${fromJsonExpr(f.type, src, f.nullable)},`);
    }
    L.push('      );');
  }
  L.push('');

  // toJson
  L.push('  Map<String, dynamic> toJson() => {');
  for (const f of cls.fields) {
    const key = f.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$');
    L.push(`        '${key}': ${toJsonExpr(f.type, f.name, f.nullable)},`);
  }
  L.push('      };');

  // copyWith
  if (options.copyWith && cls.fields.length) {
    L.push('');
    L.push(`  ${n} copyWith({`);
    for (const f of cls.fields) {
      const t = dartType(f.type);
      L.push(`    ${t === 'dynamic' ? t : t + '?'} ${f.name},`);
    }
    L.push('  }) =>');
    L.push(`      ${n}(`);
    for (const f of cls.fields) L.push(`        ${f.name}: ${f.name} ?? this.${f.name},`);
    L.push('      );');
  }

  // toString
  if (options.toString) {
    L.push('');
    L.push('  @override');
    const parts = cls.fields.map((f) => `${f.name}: $${f.name}`).join(', ');
    L.push(`  String toString() => '${n}(${parts})';`);
  }

  L.push('}');
  return L.join('\n');
}

/**
 * @param {string} jsonText raw JSON (API response)
 * @param {string} className root class name
 * @param {{nullable?: boolean, copyWith?: boolean, toString?: boolean}} opts
 * @returns {{ code: string, fileName: string, classNames: string[] }}
 */
function generate(jsonText, className, opts = {}) {
  const options = { nullable: true, copyWith: true, toString: false, ...opts };
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('Invalid JSON: ' + e.message);
  }

  const rootName = pascalCase(className || 'Model');
  let samples;
  if (Array.isArray(data)) {
    samples = data.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    if (!samples.length) throw new Error('Root array must contain at least one JSON object.');
  } else if (data && typeof data === 'object') {
    samples = [data];
  } else {
    throw new Error('Root JSON must be an object or an array of objects.');
  }

  const classes = buildClasses(rootName, samples, options);
  const code = classes.map((c) => emitClass(c, options)).join('\n\n') + '\n';
  return { code, fileName: snakeCase(rootName) + '.dart', classNames: classes.map((c) => c.name) };
}

module.exports = { generate, pascalCase, camelCase, snakeCase };
