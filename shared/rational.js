// BigInt 有理數：分母恆正、恆約分；比較用交叉相乘，不經過浮點。

function gcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Rational {
  constructor(n, d = 1n) {
    n = BigInt(n);
    d = BigInt(d);
    if (d === 0n) throw new RangeError('denominator is zero');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
    Object.freeze(this);
  }

  static from(value) {
    if (value instanceof Rational) return value;
    if (typeof value === 'string') {
      const [n, d = '1'] = value.split('/');
      return new Rational(BigInt(n.trim()), BigInt(d.trim()));
    }
    return new Rational(BigInt(value), 1n);
  }

  add(o) { o = Rational.from(o); return new Rational(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Rational.from(o); return new Rational(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Rational.from(o); return new Rational(this.n * o.n, this.d * o.d); }
  div(o) { o = Rational.from(o); return new Rational(this.n * o.d, this.d * o.n); }
  cmp(o) { o = Rational.from(o); const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
  gt(o) { return this.cmp(o) > 0; }
  eq(o) { return this.cmp(o) === 0; }
  isZero() { return this.n === 0n; }

  toString() { return `${this.n}/${this.d}`; }

  toDecimal(digits = 6) {
    const neg = this.n < 0n;
    const n = neg ? -this.n : this.n;
    const scale = 10n ** BigInt(digits);
    // 四捨五入到指定位數（僅供顯示）
    const scaled = (n * scale * 2n + this.d) / (this.d * 2n);
    const int = scaled / scale;
    const frac = (scaled % scale).toString().padStart(digits, '0');
    return `${neg ? '-' : ''}${int}${digits ? '.' + frac : ''}`;
  }

  toNumber() { return Number(this.n) / Number(this.d); }

  toJSON() {
    return { numerator: this.n.toString(), denominator: this.d.toString(), decimal: this.toDecimal(6) };
  }
}

export const ZERO = new Rational(0n);
export const ONE = new Rational(1n);
