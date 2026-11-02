import { useState } from 'react';
import { siteLabel } from './display.ts';

const sites = ['US', 'UK', 'GB', 'DE', 'JP', 'CA', 'CN', 'FR', 'IT', 'ES', 'AU'];
export function SitePicker({
  value,
  onChange,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  name?: string;
}) {
  const [custom, setCustom] = useState(!sites.includes(value));
  return (
    <>
      <label>
        站点
        <select
          value={custom ? 'other' : value}
          onChange={(event) => {
            const next = event.target.value;
            setCustom(next === 'other');
            onChange(next === 'other' ? '' : next);
          }}
        >
          {sites.map((site) => (
            <option key={site} value={site}>
              {siteLabel(site)}
              {['UK', 'GB'].includes(site) ? `（${site}）` : ''}
            </option>
          ))}
          <option value="other">其他站点</option>
        </select>
      </label>
      {custom && (
        <label>
          站点代码（与原报表一致）
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            required
            maxLength={30}
          />
        </label>
      )}
      {name && <input type="hidden" name={name} value={value} />}
    </>
  );
}
