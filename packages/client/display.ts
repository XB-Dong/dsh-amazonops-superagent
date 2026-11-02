export const timeZones: Record<string, string> = {
  'America/Los_Angeles': '美国西部时间',
  'America/New_York': '美国东部时间',
  'Europe/London': '英国时间',
  'Europe/Berlin': '德国时间',
  'Europe/Rome': '意大利时间',
  'Asia/Tokyo': '日本时间',
  'Asia/Shanghai': '北京时间',
};
export const timeZoneLabel = (value: string) => timeZones[value] ?? value;
export const siteLabel = (value: string) =>
  (
    ({
      US: '美国',
      UK: '英国',
      GB: '英国',
      DE: '德国',
      JP: '日本',
      CN: '中国',
      CA: '加拿大',
      FR: '法国',
      IT: '意大利',
      ES: '西班牙',
      AU: '澳大利亚',
    }) as Record<string, string>
  )[value] ?? value;
export const reportLabels: Record<string, string> = {
  date: '日期',
  listing: '商品编码',
  units: '销量',
  campaign: '广告活动',
  adGroup: '广告组',
  searchTerm: '搜索词',
  impressions: '展示次数',
  clicks: '点击次数',
  spend: '广告花费',
  orders: '订单数',
  revenue: '销售额',
  currency: '币种',
};
