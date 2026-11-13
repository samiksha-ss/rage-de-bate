-- Motions. Safe to re-run.
insert into public.prompts (body) values
  ('Cereal is a soup'),
  ('Sleep is a scam'),
  ('Water is a government conspiracy to sell bottles'),
  ('Forks are just spoons that gave up'),
  ('The moon is a lazy sun'),
  ('Reply-all is a war crime'),
  ('Pineapple belongs on pizza, and also on regret'),
  ('Mondays are a pyramid scheme'),
  ('Socks should be worn on hands'),
  ('Elevator small talk should be illegal'),
  ('Cats invented capitalism'),
  ('The snooze button is performance art'),
  ('Birthday candles are a fire hazard and a personality test'),
  ('Leftover pizza is a breakfast food'),
  ('Autocorrect is gaslighting'),
  ('Standing desks are just chairs in denial'),
  ('Group projects are a haunting'),
  ('Ice is just spicy water'),
  ('Brunch is lunch with a PR team'),
  ('The five-second rule is peer-reviewed')
on conflict (body) do nothing;
