import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Conversation } from './conversation';
import { RelayProvider, adapter } from './context';

afterEach(cleanup);
beforeEach(()=>adapter.reset());

function mount(role: 'founder'|'advisor', privateOnly = false): void {
  render(<MemoryRouter initialEntries={[`/${role}/chat?audience=human`]}><RelayProvider role={role}><Conversation privateOnly={privateOnly}/></RelayProvider></MemoryRouter>);
}

describe('V2 chat audiences and document attachments', () => {
  it('keeps advisor AI private even when a human audience is requested in the URL', async () => {
    mount('advisor', true);
    expect(await screen.findByRole('textbox', {name: 'Message Relay'})).toBeVisible();
    expect(screen.queryByRole('tablist', {name: 'Message audience'})).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', {name: 'Message Alex Morgan'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Add file'})).toBeVisible();
  });
  it('does not offer private uploads to a human recipient before packet handoff', async () => {
    const before=(await adapter.snapshot('founder')).data;
    await adapter.mutate('founder',{kind:'upload',expected_revision:before.revision,name:'private-new.txt',mime_type:'text/plain',bytes:7,content_base64:btoa('private')},{key:'private-upload'});
    mount('founder');
    fireEvent.click(await screen.findByRole('button',{name:'Attach from documents'}));
    expect(screen.queryByRole('checkbox',{name:'private-new.txt'})).not.toBeInTheDocument();
    expect(screen.getByText(/Share new originals through a packet handoff first/)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', {name:'Founder intake.pdf'}));
    expect(screen.getByRole('button', {name:'Attach from documents (1)'})).toBeVisible();
    fireEvent.click(screen.getByRole('tab', {name:'AI assistant'}));
    expect(screen.getByRole('tab', {name:'AI assistant'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', {name:'Attach from documents'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name:'Add file'})).toBeVisible();
    fireEvent.click(screen.getByRole('tab', {name:'Maya Chen'}));
    expect(screen.getByRole('button', {name:'Attach from documents'})).toHaveAttribute('aria-expanded','false');
    fireEvent.click(screen.getByRole('button', {name:'Attach from documents'}));
    expect(screen.getByRole('checkbox', {name:'Founder intake.pdf'})).not.toBeChecked();
    expect(screen.queryByRole('checkbox', {name:'private-new.txt'})).not.toBeInTheDocument();
    expect((await adapter.snapshot('advisor')).data.sources.some(source=>source.name==='private-new.txt')).toBe(false);
  });
  it('previews explicitly selected documents before sending a human message', async () => {
    mount('founder');
    fireEvent.click(await screen.findByRole('button', {name:'Attach from documents'}));
    fireEvent.click(screen.getByRole('checkbox', {name:'Founder intake.pdf'}));
    fireEvent.change(screen.getByRole('textbox', {name:'Message Maya Chen'}), {target:{value:'Please read this source.'}});
    fireEvent.click(screen.getByRole('button', {name:'Preview message'}));
    expect(await screen.findByRole('heading', {name:'Preview message to Maya Chen'})).toBeVisible();
    let view = (await adapter.snapshot('advisor')).data;
    expect(view.messages.some(message=>message.text==='Please read this source.')).toBe(false);
    fireEvent.click(screen.getByRole('button', {name:'Confirm simulated send'}));
    await waitFor(()=>expect(screen.getByRole('textbox', {name:'Message Maya Chen'})).toHaveValue(''));
    view = (await adapter.snapshot('advisor')).data;
    expect(view.messages.find(message=>message.text==='Please read this source.')?.attachments).toEqual(['00000000-0000-4000-8000-000000000011']);
    expect(screen.getByRole('button', {name:'Attach from documents'})).toHaveAttribute('aria-expanded','false');
  });
});
