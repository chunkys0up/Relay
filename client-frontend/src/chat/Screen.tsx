import { CaseSidebar, ChatPage, PacketReviewNotice, ScreenState, useCasePackets, useRelay } from '@relay/shared';

export default function Screen() {
  const { snapshot } = useRelay();
  const latest = useCasePackets().packets?.[0];
  return <ScreenState>{snapshot && <ChatPage title="AI Chat" subtitle="Prepare your packet with Relay" aside={<CaseSidebar/>}>
    {latest && <PacketReviewNotice packet={latest}/>}
  </ChatPage>}</ScreenState>;
}
