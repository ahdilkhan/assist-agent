//Ahdil Khan
//Date: June 24th, 2026
//Short Description: Demonstrates a generic selection sort method that can sort an ArrayList
//of any type that implements Comparable. It takes ArrayLists of Integers, Doubles,
//Strings, Characters, and Person objects, sorts each one by repeatedly finding the
//minimum element and moving it to the front of the unsorted portion, and prints
//each sorted list to the console.

import java.util.ArrayList;

public class GenericSort {
    
    public static <E extends Comparable<E>> void sort(ArrayList<E> list) {
        int n = list.size();
        for (int i = 0; i < n; i++) {
            int minIndex = i;
            for (int j = i + 1; j < n; j++) {
                if (list.get(j).compareTo(list.get(minIndex)) < 0) {
                    minIndex = j;
                }
            }
            E temp = list.get(minIndex);
            list.set(minIndex, list.get(i));
            list.set(i, temp);
        }
    }

    public static void main(String[] args) {
    
    ArrayList<Integer> intList = new ArrayList<>();
    intList.add(2);
    intList.add(4);
    intList.add(3);
    sort(intList);
    System.out.print("Sorted Integer Objects: ");
    for (int i = 0; i < intList.size(); i++) {
        System.out.print(intList.get(i));
        if (i < intList.size() - 1) System.out.print(" ");
    }
    System.out.println();

    
    ArrayList<Double> doubleList = new ArrayList<>();
    doubleList.add(3.4);
    doubleList.add(1.2);
    doubleList.add(-12.3);
    sort(doubleList);
    System.out.print("Sorted Double Objects: ");
    for (int i = 0; i < doubleList.size(); i++) {
        System.out.print(doubleList.get(i));
        if (i < doubleList.size() - 1) System.out.print(" ");
    }
    System.out.println();

    
    ArrayList<String> stringList = new ArrayList<>();
    stringList.add("Bob");
    stringList.add("Alice");
    stringList.add("Ted");
    stringList.add("Carol");
    sort(stringList);
    System.out.print("Sorted String Objects: ");
    for (int i = 0; i < stringList.size(); i++) {
        System.out.print(stringList.get(i));
        if (i < stringList.size() - 1) System.out.print(" ");
    }
    System.out.println();

    
    ArrayList<Character> charList = new ArrayList<>();
    charList.add('a');
    charList.add('b');
    charList.add('n');
    charList.add('z');
    sort(charList);
    System.out.print("Sorted Character Objects: ");
    for (int i = 0; i < charList.size(); i++) {
        System.out.print(charList.get(i));
        if (i < charList.size() - 1) System.out.print(" ");
    }
    System.out.println();

    
    ArrayList<Person> personList = new ArrayList<>();
    personList.add(new Person("Bob", 23));
    personList.add(new Person("Alice", 22));
    personList.add(new Person("Ted", 25));
    personList.add(new Person("Zoe", 19));
    sort(personList);
    System.out.println("Sorted People (by name): " + personList);
}

}