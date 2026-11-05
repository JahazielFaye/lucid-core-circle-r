const code39: Record<string, string> = {
  '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
  A:'wnnnnwnnw',B:'nnwnnwnnw',C:'wnwnnwnnn',D:'nnnnwwnnw',E:'wnnnwwnnn',F:'nnwnwwnnn',G:'nnnnnwwnw',H:'wnnnnwwnn',I:'nnwnnwwnn',J:'nnnnwwwnn',K:'wnnnnnwnw',L:'nnwnnnwnw',M:'wnwnnnwnn',N:'nnnnwnwnw',O:'wnnnwnwnn',P:'nnwnwnwnn',Q:'nnnnnnwww',R:'wnnnnnwwn',S:'nnwnnnwwn',T:'nnnnwnwwn',U:'wwnnnnnnw',V:'nwwnnnnnw',W:'wwwnnnnnn',X:'nwnnwnnnw',Y:'wwnnwnnnn',Z:'nwwnwnnnn','-':'nwnnnnwnw',' ':'nwwnnnwnn','*':'nwnnwnwnn',
};

/** A true Code 39 rendering of a Lucid-internal reference; it is not GS1 or SSCC. */
export function LucidInternalBarcode({ value }: { value: string }) {
  const encoded = `*${value.toUpperCase()}*`;
  const widths = Array.from(encoded).flatMap(character => [...(code39[character] || code39['-'])].map(mark => mark === 'w' ? 3 : 1).concat([1]));
  const total = widths.reduce((sum, width) => sum + width, 0);
  let cursor = 0;
  return <svg className="pallet-internal-barcode" viewBox={`0 0 ${total} 54`} role="img" aria-label={`Lucid internal Code 39 barcode for ${value}`} preserveAspectRatio="none">{widths.map((width, index) => { const x = cursor; cursor += width; return index % 2 === 0 ? <rect key={index} x={x} y="0" width={width} height="42" fill="currentColor" /> : null; })}<text x={total / 2} y="52" textAnchor="middle" fontSize="7" fill="currentColor">{value}</text></svg>;
}
