import type { QueueItem } from '../hooks/useLogSubmit';

interface Props {
  items: QueueItem[];
}

export function QueueToast({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="log-queue" style={{ padding: '8px 20px 0', maxWidth: 680, margin: '0 auto' }}>
      {items.map(item => (
        <div
          key={item.id}
          className={`queue-item queue-item--${item.status}${item.fading ? ' queue-item--fade' : ''}`}
        >
          {item.status === 'processing' ? (
            <div className="qi-spinner" />
          ) : (
            <span className="qi-icon">{item.status === 'success' ? '✓' : '⚠'}</span>
          )}
          <span className="qi-text">{item.message}</span>
        </div>
      ))}
    </div>
  );
}
