import { ChatPage, ScreenState, useRelay } from '@relay/shared';

export default function Screen() {
  const { snapshot } = useRelay();
  return <ScreenState>{snapshot && <ChatPage humanOnly title="Messages" subtitle={`Talk with ${snapshot.founder.name} at ${snapshot.company}`} newLabel="+ New message"/>}</ScreenState>;
}
