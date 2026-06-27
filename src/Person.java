//Ahdil Khan
//Date: June 24th, 2026
//Short Description: Represents a Person with a name (String) and age (int). It implements
//Comparable so that Person objects can be compared and sorted alphabetically by name.
//A Person is displayed as Name(Age), for example: Alice(22).

public class Person implements Comparable<Person> {
    private String name;
    private int age;

    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    public int compareTo(Person other) {
        return this.name.compareTo(other.name);
    }

    public String toString() {
        return name + "(" + age + ")";
    }
}