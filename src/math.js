export function rand(seed = 47231) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const hash = (x, z) => {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
};
export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const dx = x - ix, dz = z - iz;
  const u = dx * dx * (3 - 2 * dx), v = dz * dz * (3 - 2 * dz);
  return (1 - v) * ((1 - u) * hash(ix, iz) + u * hash(ix + 1, iz)) +
    v * ((1 - u) * hash(ix, iz + 1) + u * hash(ix + 1, iz + 1));
}
export function fbm(x, z) {
  let total = 0, weight = 0.55;
  for (let i = 0; i < 5; i++) {
    total += noise2(x, z) * weight;
    x = x * 2.03 + 19.1; z = z * 2.03 + 7.7; weight *= 0.48;
  }
  return total;
}
export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function groundHeight(x, z) {
  const flat = smoothstep(2.4, 4.9, Math.sqrt(x * x + z * z * 1.5));
  const valley = Math.pow(Math.min(1.1, Math.max(0, Math.abs(x + Math.sin(z * .10) * 1.3) - 3.4) / 10), 1.4);
  const banks = valley * (1.1 + fbm(x * .14 + 8, z * .14) * 3.7);
  const ripple = (fbm(x * .48, z * .48) - .5) * .85;
  const undulation = Math.sin(z * .15 + x * .11) * .25;
  const farHills = smoothstep(25, 65, -z) * (fbm(x * .07, z * .075) * 3.4);
  return flat * (banks + ripple + undulation + farHills) - smoothstep(3.0, 9, z) * .35;
}
