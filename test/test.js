'use strict';
const assert = require('assert');
const { generate } = require('../src/generator');

const sample = JSON.stringify({
  status: true,
  message: 'ok',
  data: {
    user_id: 5,
    full_name: 'Ali',
    rating: 4.5,
    created_at: null,
    tags: ['a', 'b'],
    matrix: [[1, 2], [3]],
    orders: [
      { id: 1, total: 10, items: [{ sku: 'x' }] },
      { id: 2, total: 12.5, note: 'gift' },
    ],
    'class': 'vip',
  },
});

const { code, fileName, classNames } = generate(sample, 'UserResponse', { toString: true });
console.log(code);
assert.strictEqual(fileName, 'user_response.dart');
assert.deepStrictEqual(classNames, ['UserResponse', 'Data', 'Order', 'Item']);
assert.ok(code.includes('final int? userId;'));
assert.ok(code.includes('final double? total;'), 'int+double merges into double');
assert.ok(code.includes('(json[\'total\'] as num?)?.toDouble()'));
assert.ok(code.includes('final dynamic createdAt;'));
assert.ok(code.includes('final List<List<int>>? matrix;'));
assert.ok(code.includes('final String? classValue;'), 'reserved word renamed');
assert.ok(code.includes("'class': classValue"));
assert.ok(code.includes('orders?.map((e) => e.toJson()).toList()'));

const strict = generate(sample, 'UserResponse', { nullable: false }).code;
assert.ok(strict.includes('required this.status'));
assert.ok(strict.includes('final String? note;'), 'missing-in-some-samples stays nullable');

const arr = generate('[{"a":1},{"b":"x"}]', 'row').code;
assert.ok(arr.includes('class Row {'));

assert.throws(() => generate('{bad', 'X'), /Invalid JSON/);
console.log('All tests passed');
