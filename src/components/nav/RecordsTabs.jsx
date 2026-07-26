import { navigate } from '../../navigation/useRoute.js';
import TabStrip from './TabStrip.jsx';

// 「記録」タブ配下の内部タブ。見た目は TabStrip が Library / Gallery と共通で持つ。
const TABS = [
  { key: 'endings', label: 'エンディング図鑑' },
  { key: 'achievements', label: '実績' },
];

export default function RecordsTabs({ active }) {
  return (
    <TabStrip
      tabs={TABS}
      active={active}
      onSelect={(key) => navigate({ name: 'records', recordsTab: key })}
    />
  );
}
