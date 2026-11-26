'use strict';
const $ = id => document.getElementById(id);
const form = document.querySelector('form');
const tabs = [...document.querySelectorAll('nav button')];
const details = document.querySelector('details');
const memory = new DataView(new ArrayBuffer(8));
const actions = ['Convert', 'Round value', 'Add operands', 'Multiply operands'];
let mode = 0;


function bits(value) {
  memory.setFloat64(0, value);
  return memory.getBigUint64(0);
}

function operand(text) {
  const s = text.trim();
  if ($('format').selectedIndex === 2) {
    if (!/^(?:0x)?[0-9a-f]{16}$/i.test(s)) throw Error('Enter exactly 16 hexadecimal digits per operand.');
    memory.setBigUint64(0, BigInt('0x' + s.replace(/^0x/i, '')));
    return memory.getFloat64(0);
  }
  if (!/^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|Infinity|NaN)$/i.test(s))
    throw Error('Enter a decimal number, Infinity, or NaN.');
  if (/infinity/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
  return Number(s);
}

// Retain digits in the original radix so halfway cases stay exact.

function rounding(text, radix, precision) {
  const s = text.trim();
  const valid = radix === 2 ? /^[+-]?(?:[01]+\.?[01]*|\.[01]+)$/ : /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  if (!valid.test(s)) throw Error('Enter a fixed-point value in the selected base.');
  const negative = s.startsWith('-');
  const [whole, fraction = ''] = s.replace(/^[+-]/, '').split('.');
  const raw = whole + fraction;
  const digits = raw.replace(/^0+/, '');
  if (!digits) return Array(4).fill(negative ? '-0' : '0');
  const keep = digits.slice(0, precision).padEnd(precision, '0');
  const tail = digits.slice(precision);
  const nonzero = /[1-9]/.test(tail);
  const first = Number(tail[0] || 0);
  const odd = Number(keep.at(-1)) % 2 === 1;
  const nearest = first > radix / 2 || (first === radix / 2 && (/[1-9]/.test(tail.slice(1)) || odd));
  const power = whole.length - (raw.length - digits.length) - precision;
  return [false, !negative && nonzero, negative && nonzero, nearest].map(increment => {
    let result = (BigInt((radix === 2 ? '0b' : '') + keep) + BigInt(increment)).toString(radix);
    if (power >= 0) result += '0'.repeat(power);
    else {
      result = result.padStart(1 - power, '0');
      result = result.slice(0, power) + '.' + result.slice(power);
      if (result.replace(/^0*\.?0*/, '').replace('.', '').length > precision && result.endsWith('0')) result = result.slice(0, -1).replace(/\.$/, '');
    }
    return (negative ? '-' : '') + result;
  });
}

function unpack(n) {
  const word = bits(n);
  const exponent = Number((word >> 52n) & 2047n);
  let integer = word & ((1n << 52n) - 1n);
  if (exponent) integer += 1n << 52n;
  if (word >> 63n) integer = -integer;
  return {integer, scale: Math.max(exponent, 1) - 1075};
}
// Each exact operand is a signed integer significand times a power of two.

function trace(a, b, result) {
  const steps = [];
  if (![a, b].every(Number.isFinite)) return ['Classify operands before alignment.', 'IEEE special-value rules give ' + String(result) + '. GRS rounding is unnecessary.'];
  const x = unpack(a), y = unpack(b);
  steps.push('Decode A = ' + x.integer + ' × 2^' + x.scale + ' and B = ' + y.integer + ' × 2^' + y.scale + '.');
  let n, scale;
  if (mode === 2) {
    scale = Math.min(x.scale, y.scale);
    n = (x.integer << BigInt(x.scale - scale)) + (y.integer << BigInt(y.scale - scale));
    steps.push('Align exactly at 2^' + scale + ' and add signed significands.');
  } else {
    n = x.integer * y.integer;
    scale = x.scale + y.scale;
    steps.push('Multiply signed significands and add their exponents.');
  }
  if (!n) return [...steps, 'The exact result is zero. No digits are discarded.'];
  const magnitude = n < 0n ? -n : n;
  const width = magnitude.toString(2).length;
  const drop = Math.max(0, width - 53, -1074 - scale);
  const shift = BigInt(drop);
  const kept = magnitude >> shift;
  const bit = k => k < 0 ? 0 : Number((magnitude >> BigInt(k)) & 1n);
  const g = bit(drop - 1), r = bit(drop - 2);
  const sticky = Number((magnitude & ((1n << BigInt(Math.max(0, drop - 2))) - 1n)) !== 0n);
  steps.push('Exact magnitude = ' + magnitude.toString(2) + '₂ × 2^' + scale + '. Retain ' + kept.toString(2) + '₂ at scale 2^' + (scale + drop) + '.');
  steps.push('Guard ' + g + ' · Round ' + r + ' · Sticky ' + sticky + '. ' + (g && (r || sticky || (kept & 1n)) ? 'Increment' : 'Keep') + ' the retained magnitude (nearest, ties to even).');
  if (!Number.isFinite(result)) steps.push('The rounded exponent exceeds the finite range. Encode infinity.');
  return steps;
}

function clear(message) {
  $('status').textContent = message;
  $('encoding').hidden = $('rounded').hidden = details.hidden = true;
}

function calculate() {
  clear('');
  try {
    if (mode === 1) {
      const precision = Number($('precision').value);
      if (!Number.isInteger(precision) || precision < 1 || precision > 1024) throw Error('Choose a precision from 1 to 1024.');
      const values = rounding($('first').value, $('format').selectedIndex === 1 ? 2 : 10, precision);
      document.querySelectorAll('dd').forEach((node, i) => node.textContent = values[i]);
      $('rounded').hidden = false;
      return;
    }
    const a = operand($('first').value);
    const b = mode > 1 ? operand($('second').value) : 0;
    const result = mode === 2 ? a + b : mode === 3 ? a * b : a;
    const word = bits(result), binary = word.toString(2).padStart(64, '0');
    $('part0').textContent = binary[0];
    $('part1').textContent = binary.slice(1, 12);
    $('part2').textContent = binary.slice(12).match(/.{4}/g).join(' ');
    $('hex').textContent = '0x' + word.toString(16).toUpperCase().padStart(16, '0');
    $('decimal').textContent = Object.is(result, -0) ? '-0' : String(result);
    $('decRow').hidden = mode === 0;
    $('encoding').hidden = false;
    if (mode > 1) {
      document.querySelector('ol').replaceChildren(...trace(a, b, result).map(step => {
        const item = document.createElement('li');
        item.textContent = step;
        return item;
      }));
      details.hidden = false;
    }
  } catch (error) {
    clear(error.message);
  }
}

function formatLabels() {
  const binary = $('format').selectedIndex === 1;
  $('precisionLabel').firstElementChild.textContent = binary ? 'Significant bits' : 'Significant digits';
  $('first').placeholder = binary ? '1.10101' : $('format').selectedIndex === 2 ? '3FF8000000000000' : '13.25';
  $('second').placeholder = $('first').placeholder;
}
const saved = [['13.25', '', '4', 0], ['-36.6265', '', '4', 0], ['1.5', '0.25', '4', 0], ['1.5', '0.25', '4', 0]];

function selectMode(i) {
  mode = i;
  const [a, b, p, f] = saved[i];
  $('first').value = a;
  $('second').value = b;
  $('precision').value = p;
  $('format').selectedIndex = f;
  $('format').options[1].hidden = i !== 1;
  $('format').options[2].hidden = i < 2;
  $('formatLabel').hidden = i === 0;
  $('secondLabel').hidden = i < 2;
  $('second').disabled = i < 2;
  $('second').required = i > 1;
  $('precisionLabel').hidden = i !== 1;
  $('precision').disabled = i !== 1;
  $('firstLabel').textContent = ['Decimal value', 'Value', 'Operand A', 'Operand A'][i];
  tabs.forEach((tab, index) => tab.setAttribute('aria-pressed', String(i === index)));
  document.querySelector('h1').textContent = tabs[i].textContent;
  document.querySelector('.action').textContent = actions[i];
  formatLabels();
  calculate();
}
tabs.forEach((tab, i) => tab.addEventListener('click', () => {
  saved[mode] = [$('first').value, $('second').value, $('precision').value, $('format').selectedIndex];
  selectMode(i);
}));
form.addEventListener('input', () => {
  formatLabels();
  clear('Submit to see the updated result.');
});
form.addEventListener('submit', event => {
  event.preventDefault();
  calculate();
});
selectMode(0);
