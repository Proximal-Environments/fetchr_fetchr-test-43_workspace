import axios from 'axios';

async function trackPackage() {
  const apiKey = '564CE1732CB03B61E1A77C490EFEEC5E';
  const trackingNumber = 'D10015856799982';

  try {
    const response = await axios.post(
      'https://api.17track.net/track/v2.2/register',
      [{ number: trackingNumber }],
      {
        headers: {
          '17token': apiKey,
          'Content-Type': 'application/json',
        },
      },
    );

    const trackResponse = await axios.post(
      'https://api.17track.net/track/v2.2/gettrackinfo',
      [
        {
          number: trackingNumber,
        },
      ],
      {
        headers: {
          '17token': apiKey,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error('Error tracking package:', error.response?.data || error.message);
    if (error.response?.data) {
      console.log('Detailed error:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

trackPackage();
