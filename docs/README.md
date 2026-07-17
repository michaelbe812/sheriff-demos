Phases
- /apps 
- /apps and /libs. in libs we have would have typically one nx lib for a domain e.g. booking. 

scopes:
- domain
- shared
- core? /shared-features? für sowas wie /layout oder /auth-infrastructure


types:
- feature
- ui
- utuils
- type
- data-access / client / api-internal / api
- api (public api of a feature which can be used by other features) / port? 

Wie Signal Store
- für eine domain
- für ein feature
- für eine ui component 
sodass auch regel beachtet wird: Ein Store aus einer domain oder einem feature kann nicht in ui genutzt werden 

- signal store events - wo unterbringen? Event kann von feat oder ui component geworfen werden
- business logic services? -> in feature? 
- routes.ts? / brauchen wir sowas wi shell?

Access Rules


Strukturen
/shared
  /ui
  /utils
  /types
  /api
/domains
  /booking
    /internal <- was können wir hier teilen?`business logik services? signal store events? 
    /port
    /api
    /utils
    /ui
    /types
    booking.routes.ts ? 
    booking.shell.component.ts?
    <--- das alles ist domain-shared. alle innerhalb der domain dürfen unter beachtung der zugirffsregeln darauf zugreifen 
    /feat-check-booking
      /api
      /utils
      /ui
      /types
      feat-check-booking.component.ts
      feat-check-booking-store.ts // store 
      signal store events? 
      <-- alles nur für dieses feature 
