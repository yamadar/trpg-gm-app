export default function TopImage({ src, alt = '', width = 112, height = 76, style }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      style={{
        width,
        height,
        objectFit: 'cover',
        borderRadius: 5,
        flexShrink: 0,
        display: 'block',
        ...style,
      }}
    />
  );
}
