import { Component } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught an error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink, marginBottom: 12 }}>
            表示中に問題が発生しました
          </div>
          <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.inkSoft, marginBottom: 20 }}>
            予期しないエラーで画面を表示できなかった。ページを再読み込みしてください。
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              fontFamily: F_MONO,
              fontSize: 13,
              padding: '10px 16px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              background: COLORS.brass,
              color: COLORS.paper,
            }}
          >
            再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
