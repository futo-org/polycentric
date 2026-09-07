import Icon from '@/src/common/components/Icon';
import { Text } from '@/src/common/components/primitives';
import { Routes } from '@/src/common/constants';
import { Atoms } from '@/src/common/theme';
import { router } from 'expo-router';
import { SearchField } from './SearchField';

export function SearchBar() {
  return (
    <SearchField
      accessibilityRole="button"
      accessibilityLabel="Search"
      onPress={() => router.push(Routes.tabs.explore.search)}
    >
      <Icon name="search" size={16} color="neutral_500" />
      <Text color="neutral_500" style={Atoms.flex_1} numberOfLines={1}>
        Search
      </Text>
    </SearchField>
  );
}
