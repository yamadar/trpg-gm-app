import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  BreadcrumbProvider,
  useBreadcrumbLabel,
  useBreadcrumbLabels,
  useBreadcrumbTail,
} from './BreadcrumbContext.jsx';

function Tail() {
  return <div data-testid="tail">{useBreadcrumbTail() ?? '(none)'}</div>;
}

function Keyed({ crumbKey }) {
  return <div data-testid={crumbKey}>{useBreadcrumbLabels()[crumbKey] ?? '(none)'}</div>;
}

function Screen({ label }) {
  useBreadcrumbLabel(label);
  return null;
}

function KeyedScreen({ label, crumbKey }) {
  useBreadcrumbLabel(label, crumbKey);
  return null;
}

describe('BreadcrumbContext', () => {
  it('starts with no label', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });

  it('exposes a label registered by a screen', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('アーカム 1920s');
  });

  it('updates when the screen changes its label', () => {
    const { rerender } = render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    rerender(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アルデン辺境領" />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('アルデン辺境領');
  });

  it('clears the label when the screen unmounts', () => {
    const { rerender } = render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    rerender(
      <BreadcrumbProvider>
        <Tail />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });

  it('treats an undefined label as absent', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label={undefined} />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });

  it('holds a mid-trail label alongside the tail, under its own key', () => {
    // ユーザーページは「プロフィール段の表示名」と「末尾のアイテム名」を同時に登録する。
    render(
      <BreadcrumbProvider>
        <Tail />
        <Keyed crumbKey="user" />
        <KeyedScreen label="Alice" crumbKey="user" />
        <Screen label="丘の上の写真館" />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('user')).toHaveTextContent('Alice');
    expect(screen.getByTestId('tail')).toHaveTextContent('丘の上の写真館');
  });

  it('clears only the key it owns when that screen unmounts', () => {
    const { rerender } = render(
      <BreadcrumbProvider>
        <Tail />
        <Keyed crumbKey="user" />
        <KeyedScreen key="profile" label="Alice" crumbKey="user" />
        <Screen key="item" label="丘の上の写真館" />
      </BreadcrumbProvider>
    );
    rerender(
      <BreadcrumbProvider>
        <Tail />
        <Keyed crumbKey="user" />
        <KeyedScreen key="profile" label="Alice" crumbKey="user" />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('user')).toHaveTextContent('Alice');
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });

  it('keeps the later screen label when an earlier screen unmounts after handover', () => {
    // 遷移先の画面が先にラベルを登録し、その後で遷移元の画面がアンマウントされる
    // ケースを再現する。keyを分けて実体を別コンポーネントとして扱わせることで、
    // 2番目のScreenを差し替えではなく1番目のScreenのアンマウントとして発生させる。
    const { rerender } = render(
      <BreadcrumbProvider>
        <Tail />
        <Screen key="outgoing" label="アーカム 1920s" />
        <Screen key="incoming" label="アルデン辺境領" />
      </BreadcrumbProvider>
    );
    // 両方のマウントエフェクトが走った後、後にマウントしたincoming側のラベルが表示されている。
    expect(screen.getByTestId('tail')).toHaveTextContent('アルデン辺境領');

    // outgoingのみを取り除く。incomingは再レンダーされず、そのラベルは
    // 既にコンテキストへ登録済みの状態でoutgoingのクリーンアップが走る。
    rerender(
      <BreadcrumbProvider>
        <Tail />
        <Screen key="incoming" label="アルデン辺境領" />
      </BreadcrumbProvider>
    );

    // 所有権ガードがなければ、outgoingのクリーンアップがincomingのラベルを消してしまう。
    expect(screen.getByTestId('tail')).toHaveTextContent('アルデン辺境領');
  });
});
