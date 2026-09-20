import { trackEvent } from '@/lib/analytics';
import { Store } from '@tanstack/react-store';

type StoreState = {
  activeOutlookTab: 'severeWeatherOutlook' | 'thunderstormOutlook';
  activeAlertReference?: {
    alertIds: string[];
    date: string;
  };
  activeSevereWeatherOutlookReference?: {
    date: string;
    quotes: string[];
    keywords: string[];
  };
  activeThunderstormOutlookReference?: {
    date: string;
    quotes: string[];
    keywords: string[];
  };
};

export const store = new Store<StoreState>({
  activeOutlookTab: 'severeWeatherOutlook',
});

export const setActiveOutlookTab = (
  activeOutlookTab: StoreState['activeOutlookTab'],
) => {
  if (store.state.activeOutlookTab !== activeOutlookTab) {
    trackEvent('outlook_tab_switch', { tab: activeOutlookTab });
  }
  store.setState((state) => {
    return {
      ...state,
      activeOutlookTab,
    };
  });
};

export const setActiveAlertReference = (
  activeAlertReference: StoreState['activeAlertReference'],
) => {
  trackEvent('summary_source_click', { type: 'alert' });
  store.setState((state) => {
    return {
      ...state,
      activeAlertReference,
      activeThunderstormOutlookReference: undefined,
      activeSevereWeatherOutlookReference: undefined,
    };
  });
};

export const setActiveSevereWeatherOutlookReference = (
  activeSevereWeatherOutlookReference: StoreState['activeSevereWeatherOutlookReference'],
) => {
  trackEvent('summary_source_click', { type: 'severe_weather_outlook' });
  store.setState((state) => {
    return {
      ...state,
      activeOutlookTab: 'severeWeatherOutlook',
      activeSevereWeatherOutlookReference,
      activeThunderstormOutlookReference: undefined,
      activeAlertReference: undefined,
    };
  });
};

export const setActiveThunderstormOutlookReference = (
  activeThunderstormOutlookReference: StoreState['activeThunderstormOutlookReference'],
) => {
  trackEvent('summary_source_click', { type: 'thunderstorm_outlook' });
  store.setState((state) => {
    return {
      ...state,
      activeOutlookTab: 'thunderstormOutlook',
      activeThunderstormOutlookReference,
      activeSevereWeatherOutlookReference: undefined,
      activeAlertReference: undefined,
    };
  });
};

export const removeActiveAlertReference = () => {
  store.setState((state) => {
    return {
      ...state,
      activeAlertReference: undefined,
    };
  });
};

export const removeactiveSevereWeatherOutlookReference = () => {
  store.setState((state) => {
    return {
      ...state,
      activeSevereWeatherOutlookReference: undefined,
    };
  });
};

export const removeActiveThunderstormOutlookReference = () => {
  store.setState((state) => {
    return {
      ...state,
      activeThunderstormOutlookReference: undefined,
    };
  });
};
