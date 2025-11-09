1. Friend Concert Visibility

* Users should be able to pick friends manually
* Limit to 5 people
* Yes, friends are selected manually, by default only current user's concerts are visible

2. Map Interaction & Grouping

* Show a popup list of concerts in that cluster
* Concerts at the same venue on different dates can be clustered
* Multiple concerts on the same date in the same city should be clustered with a warning sign

3. Timeline Functionality
* Should the timeline show a visual representation of concert density over time (like a histogram)? - No, at least for now
* Update in real time
* There should be preset timeframes (e.g., "Next Month", "Next 3 Months", "This Summer")
* Maximum timeframe is 3 months

4. Concert Filtering & Display
* Only upcoming concerts
* Should users be able to filter by:
Artist?
Country?
"Interested" status?
Friend's interested status?
- All of the above

* The map should show only concerts from active countries (per user settings)
 
5. "Close Concerts" Feature

* For now, don't implement this - "closeness" by distance will be determined visually, dates - by the selected timeframe window

6. Color Coding
You mentioned blue for user, purple for friends - should:
* Each friend get a unique color
* Same concert that both user and friend are interested in should be displayed with a fire emoji

7. Concert Details on Map
* When clicking a concert marker, it should show a popup with concert details, a list of friends who also have this concert in their list, a "pin" (interested) button and a link to concert details (opens in new tab of the browser)

8. Technical Preferences

* Map library preference: Decide based on the required features. It should be free of charge.
* Geocoding: use city-level coordinates initially
* Yes, /map, a new page

9. Performance Considerations
With potentially hundreds of concerts across multiple friends, should we:
* Lazy load concerts as the map viewport changes? - yes
* Set a maximum number of concerts to display at once? - no
* Only load concerts within the visible timeframe? - yes

10. Mobile Responsiveness
Should the timeline be:
* Horizontal on desktop, vertical on mobile? - yes
* Touch-friendly for mobile users? - preferably
* Should the map be full-screen or have a split layout with concert list? - it should be toggleable, allowing the user to show/hide concerts list

Implementation Scope Questions

11. Data Requirements
For now, we use city-level coordinates that are already in the database

12. Privacy & Permissions
* Should users be able to hide their concerts from friends on the map? - yes, through User Settings/Privacy (new tab)
* Should there be privacy settings per concert or globally? - Globally (see above) and per concert (a button inside the concerts detail page)