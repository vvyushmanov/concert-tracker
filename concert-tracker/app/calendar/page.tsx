import { prisma } from '@/lib/prisma';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek } from 'date-fns';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  // Get all concerts
  const concerts = await prisma.concert.findMany({
    include: {
      artist: true,
    },
    orderBy: {
      dateStart: 'asc',
    },
  });

  // Get current month
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  
  // Get all days in the calendar view
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Group concerts by date
  const concertsByDate = concerts.reduce((acc, concert) => {
    const dateKey = format(new Date(concert.dateStart * 1000), 'yyyy-MM-dd');
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(concert);
    return acc;
  }, {} as Record<string, typeof concerts>);

  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900">
      <main className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Calendar</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {format(today, 'MMMM yyyy')}
          </p>
        </div>

        {/* Calendar Grid */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-2 mb-4">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center font-semibold text-gray-600 dark:text-gray-400 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-2">
            {days.map((day) => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayConcerts = concertsByDate[dateKey] || [];
              const isToday = isSameDay(day, today);
              const isCurrentMonth = day.getMonth() === today.getMonth();

              return (
                <div
                  key={day.toISOString()}
                  className={`
                    min-h-24 p-2 border rounded-lg
                    ${isToday ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'}
                    ${!isCurrentMonth ? 'opacity-40' : ''}
                    ${dayConcerts.length > 0 ? 'bg-green-50 dark:bg-green-900/10' : ''}
                  `}
                >
                  <div className={`text-sm font-semibold mb-1 ${isToday ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                    {format(day, 'd')}
                  </div>
                  
                  {dayConcerts.length > 0 && (
                    <div className="space-y-1">
                      {dayConcerts.slice(0, 2).map((concert) => (
                        <Link
                          key={concert.id}
                          href={`/artists/${concert.artistId}`}
                          className="block text-xs p-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800 truncate"
                          title={`${concert.artist.name} - ${concert.eventName}`}
                        >
                          🎤 {concert.artist.name}
                        </Link>
                      ))}
                      {dayConcerts.length > 2 && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 pl-1">
                          +{dayConcerts.length - 2} more
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Upcoming concerts list */}
        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-4">Upcoming Concerts</h2>
          <div className="space-y-3">
            {concerts.slice(0, 10).map((concert) => {
              const startDate = new Date(concert.dateStart * 1000);
              const endDate = new Date(concert.dateEnd * 1000);
              const isSameDay = concert.dateStart === concert.dateEnd;

              return (
                <div
                  key={concert.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 flex items-center gap-4"
                >
                  <div className="text-center min-w-16">
                    <div className="text-2xl font-bold">{format(startDate, 'd')}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{format(startDate, 'MMM')}</div>
                  </div>
                  
                  <div className="flex-1">
                    <Link
                      href={`/artists/${concert.artistId}`}
                      className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {concert.artist.name}
                    </Link>
                    <h3 className="font-bold">{concert.eventName}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      📍 {concert.venue}, {concert.city}, {concert.country}
                    </p>
                  </div>
                  
                  <a
                    href={concert.eventUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                  >
                    View Event
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
