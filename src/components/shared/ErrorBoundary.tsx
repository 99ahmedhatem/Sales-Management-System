import { Component, ErrorInfo, ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

/** يمنع شاشة بيضا: أي خطأ في صفحة بيتعرض برسالة وزر إعادة المحاولة، والباقي (الشريط الجانبي) يفضل شغّال. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // لما المستخدم يغيّر الصفحة، نرجّع الحالة الطبيعية
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
  }
}

/** Class components can't call useI18n(), so the translated message lives here. */
function ErrorFallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="p-6">
      <div className="max-w-xl bg-[#161616] border border-[#4a2a2a] rounded-lg p-5">
        <h2 className="text-white font-semibold mb-1">{t('Something went wrong on this page')}</h2>
        <p className="text-sm text-[#a3a3a3] break-words mb-4">{message}</p>
        <div className="flex gap-2">
          <button onClick={onRetry} className="px-3 py-1.5 text-sm rounded bg-[#dfff03] text-black font-medium">{t('Try again')}</button>
          <button onClick={() => window.location.reload()} className="px-3 py-1.5 text-sm rounded border border-[#262626] text-white">{t('Reload')}</button>
        </div>
      </div>
    </div>
  );
}
