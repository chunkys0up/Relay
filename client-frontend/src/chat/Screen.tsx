import { Link } from 'react-router-dom';
import { CaseSidebar, ChatPage, ScreenState, useRelay } from '@relay/shared';

export default function Screen() {
  const { snapshot } = useRelay();
  const sentClarification = snapshot?.clarifications.find((question) => question.packet_version_id === snapshot.current_packet_version_id && question.status === 'sent');
  return <ScreenState>{snapshot && <ChatPage title="AI Chat" subtitle="Prepare your packet with Relay" aside={<CaseSidebar/>}>
    {sentClarification && <section className="chat-page-clarification" aria-label="Advisor question"><p>{snapshot.advisors[0]?.name ?? 'Your advisor'} sent you a question about your packet.</p><Link className="chat-page-action" to="/founder/home/clarification">Answer the question</Link></section>}
  </ChatPage>}</ScreenState>;
}
