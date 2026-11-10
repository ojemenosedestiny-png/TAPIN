-- Kiosk voice clips (ElevenLabs), made once per phrase and reused. Private: only the server reads and
-- writes them (service role); kiosks get the audio through /api/voice.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 524288, array['audio/mpeg'])
on conflict (id) do nothing;
