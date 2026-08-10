import { useEffect, useState } from 'react';
import { COLORS, F_BODY, F_DISPLAY, F_MONO } from '../theme.js';
import { getNovel, getServerSession } from '../api/sessionSyncClient.js';
import { sceneImageUrl } from '../api/sceneImageClient.js';
import { attachmentUrl, getAttachments } from '../api/attachmentClient.js';
import { useBreadcrumbLabel } from '../navigation/BreadcrumbContext.jsx';
import Card from '../components/ui/Card.jsx';
import NovelBody from '../components/share/NovelBody.jsx';

// フロントだけ先に更新された開発環境・ローリング更新中の配信では、旧APIが一時的に
// { text, stale } を返すことがある。その場合も本文を空にせず、セッションから題名を補う。
// 旧API本文には位置マーカーが無いため挿絵は出さない。末尾へ誤配置するより欠落を優先する。
export async function loadNovelForReader(sessionId) {
  const item = await getNovel(sessionId);
  if (typeof item.raw === 'string' && item.title) return item;

  const session = await getServerSession(sessionId).catch(() => null);
  return {
    ...item,
    title: item.title || session?.title || '小説',
    raw: typeof item.raw === 'string' ? item.raw : String(item.text ?? ''),
    imageIds: Array.isArray(item.imageIds) ? item.imageIds : [],
    truncated: item.truncated === true,
  };
}

// 生成済み小説の本人専用読書画面。データ取得は認証済みのセッションAPIだけを通るため、
// 公開するまで他アカウントや未ログイン利用者へ本文・挿絵は渡らない。
export default function NovelReader({ sessionId }) {
  const [novel, setNovel] = useState(null);
  const [attachmentCollection, setAttachmentCollection] = useState({ topImageId: null, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useBreadcrumbLabel(novel?.title ?? null);

  useEffect(() => {
    let cancelled = false;
    setNovel(null);
    setLoading(true);
    setError('');
    (async () => {
      try {
        const item = await loadNovelForReader(sessionId);
        if (!cancelled) setNovel(item);
      } catch (cause) {
        if (!cancelled) setError(cause.status === 401 ? '小説を読むにはログインが必要です' : `取得に失敗した: ${cause.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setAttachmentCollection({ topImageId: null, items: [] });
    getAttachments({ type: 'novel', sessionId })
      .then((collection) => {
        if (!cancelled) {
          setAttachmentCollection({
            topImageId: collection.topImageId ?? null,
            items: Array.isArray(collection.items) ? collection.items : [],
          });
        }
      })
      // 小説本文は添付画像が無くても読める。公開画面と同じく、画像が取れない場合は本文を優先する。
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const wrapStyle = { maxWidth: 720, margin: '0 auto', padding: '24px 20px 40px' };
  if (loading) {
    return <div style={{ ...wrapStyle, fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>;
  }
  if (error) {
    return <div style={{ ...wrapStyle, fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp }}>{error}</div>;
  }
  if (!novel) return null;

  const topImage = attachmentCollection.items.find((image) => image.id === attachmentCollection.topImageId) ?? null;
  const galleryImages = attachmentCollection.items.filter((image) => image.id !== attachmentCollection.topImageId);
  const owner = { type: 'novel', sessionId };

  return (
    <div style={wrapStyle}>
      <Card>
        {topImage && (
          <figure style={{ margin: '0 0 18px' }}>
            <img
              src={attachmentUrl(owner, topImage.id)}
              alt={topImage.description || `${novel.title}のトップ画像`}
              style={{ display: 'block', width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 6 }}
            />
            {topImage.description && (
              <figcaption style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft, marginTop: 6 }}>
                {topImage.description}
              </figcaption>
            )}
          </figure>
        )}
        <div style={{ fontFamily: F_DISPLAY, fontSize: 18, color: COLORS.ink, marginBottom: 12 }}>{novel.title}</div>
        {novel.stale && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.brassDark, marginBottom: 12 }}>
            生成済みの小説は最新のログを反映していない可能性があります。
          </div>
        )}
        {novel.truncated && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.brassDark, marginBottom: 12 }}>
            小説が出力上限に達したため、末尾が欠けている可能性があります。
          </div>
        )}
        <NovelBody
          raw={novel.raw}
          imageIds={novel.imageIds}
          imageUrl={(imageId) => sceneImageUrl(sessionId, imageId)}
          title={novel.title}
        />
        {galleryImages.length > 0 && (
          <section style={{ margin: '24px 0' }}>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginBottom: 10 }}>
              添付画像
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              {galleryImages.map((image) => (
                <figure key={image.id} style={{ margin: 0 }}>
                  <img
                    src={attachmentUrl(owner, image.id)}
                    alt={image.description || '添付画像'}
                    loading="lazy"
                    style={{ width: '100%', height: 180, objectFit: 'contain', borderRadius: 5 }}
                  />
                  {image.description && (
                    <figcaption style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft, marginTop: 5 }}>
                      {image.description}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </section>
        )}
      </Card>
    </div>
  );
}
